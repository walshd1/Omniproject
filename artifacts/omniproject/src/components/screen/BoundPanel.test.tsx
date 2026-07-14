import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ScreenRenderer } from "./ScreenRenderer";
import { BoundPanel } from "./BoundPanel";
import type { ScreenDef, Panel } from "../../lib/screen";

/**
 * Per-panel data binding: a panel with a `source` fetches its OWN data (merged into
 * config) and gets its OWN refresh control, independent of the other panels.
 */
function clientWith(seed: Record<string, unknown>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  for (const [key, val] of Object.entries(seed)) qc.setQueryData(["panel-data", key], val);
  return qc;
}

describe("per-panel data binding", () => {
  it("merges fetched data into a sourced panel and gives it its own refresh", () => {
    const client = clientWith({
      "/api/g": { nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }], edges: [{ from: "b", to: "a" }] },
    });
    const s: ScreenDef = {
      id: "viz", label: "Viz",
      panels: [{ id: "g", kind: "graph", title: "Deps", source: { url: "/api/g" }, config: {} }],
    };
    renderWithProviders(<ScreenRenderer screen={s} />, { client });
    // the panel is wrapped + has its own refresh control
    expect(screen.getByTestId("bound-panel-g")).toBeInTheDocument();
    expect(screen.getByTestId("panel-refresh-g")).toBeInTheDocument();
    // the fetched data reached the graph (labels rendered) — i.e. it was merged into config
    expect(screen.getAllByText(/Alpha|Beta/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("graph-svg").querySelectorAll("circle").length).toBe(2);
  });

  it("a panel WITHOUT a source renders directly (no binding wrapper)", () => {
    const s: ScreenDef = {
      id: "x", label: "X",
      panels: [{ id: "m", kind: "metric", title: "Open", config: { value: 7 } }],
    };
    renderWithProviders(<ScreenRenderer screen={s} />);
    expect(screen.queryByTestId("bound-panel-m")).not.toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("each sourced panel has its own independent refresh control", () => {
    const client = clientWith({ "/api/a": { value: 1 }, "/api/b": { value: 2 } });
    const s: ScreenDef = {
      id: "multi", label: "Multi",
      panels: [
        { id: "a", kind: "metric", title: "A", source: { url: "/api/a" }, config: {} },
        { id: "b", kind: "metric", title: "B", source: { url: "/api/b" }, config: {} },
      ],
    };
    renderWithProviders(<ScreenRenderer screen={s} />, { client });
    // two distinct refresh controls — refreshing one touches only its own query key
    expect(screen.getByTestId("panel-refresh-a")).toBeInTheDocument();
    expect(screen.getByTestId("panel-refresh-b")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("panel-refresh-a")); // does not throw / affect b
    expect(screen.getByTestId("bound-panel-b")).toBeInTheDocument();
  });
});

/**
 * BoundPanel rendered directly, to reach the loading / error / live-refresh branches the
 * happy-path ScreenRenderer tests (pre-seeded caches) never enter.
 */
const renderInner = (p: Panel) => <div data-testid="inner">{String(p.config?.["value"] ?? "none")}</div>;

describe("BoundPanel loading and error states", () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of the fetch stub
    delete globalThis.fetch;
  });

  it("shows a skeleton and a disabled/busy refresh control while the first load is in flight", () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch; // never resolves
    const panel: Panel = { id: "p", kind: "metric", title: "Loading one", source: { url: "/api/slow" }, config: {} };
    renderWithProviders(<BoundPanel panel={panel} render={renderInner} />);
    expect(screen.getByTestId("panel-skeleton-p")).toBeInTheDocument();
    expect(screen.queryByTestId("inner")).not.toBeInTheDocument();
    const refresh = screen.getByTestId("panel-refresh-p");
    expect(refresh).toBeDisabled(); // isFetching
    expect(refresh).toHaveTextContent("…");
  });

  it("surfaces a failure alert when the panel's fetch rejects, and still renders the panel body", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    const panel: Panel = { id: "e", kind: "metric", source: { url: "/api/broken" }, config: { value: "fallback" } };
    renderWithProviders(<BoundPanel panel={panel} render={renderInner} />);
    expect(await screen.findByTestId("panel-error-e")).toHaveTextContent("failed to load");
    // body still rendered (from the panel's own config, no fetched data merged)
    expect(screen.getByTestId("inner")).toHaveTextContent("fallback");
  });

  it("labels the refresh control by id when the panel has no title", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    client.setQueryData(["panel-data", "/api/x"], { value: 3 });
    const panel: Panel = { id: "untitled", kind: "metric", source: { url: "/api/x" }, config: {} };
    renderWithProviders(<BoundPanel panel={panel} render={renderInner} />, { client });
    expect(screen.getByLabelText("Refresh untitled")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-error-untitled")).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-skeleton-untitled")).not.toBeInTheDocument();
  });
});

/**
 * Live, push-based revalidation — a panel opted into `source.live` shows the LIVE badge and
 * revalidates ONLY itself when a matching notification arrives on the shared stream.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private listeners: Record<string, Array<(ev: { data: string }) => void>> = {};
  closed = false;
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, cb: (ev: { data: string }) => void): void { (this.listeners[type] ??= []).push(cb); }
  close(): void { this.closed = true; }
  emit(type: string, data: unknown): void { for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) }); }
}

describe("BoundPanel live refresh", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error test-only cleanup of the fetch stub
    delete globalThis.fetch;
  });

  function seededLiveClient(): QueryClient {
    globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ value: 1 }) } as Response)) as unknown as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    client.setQueryData(["panel-data", "/api/live"], { value: 1 });
    return client;
  }

  it("shows the LIVE badge and revalidates only itself when a matching event arrives", () => {
    const client = seededLiveClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const panel: Panel = { id: "lv", kind: "metric", source: { url: "/api/live", live: true } };
    renderWithProviders(<BoundPanel panel={panel} render={renderInner} />, { client });

    expect(screen.getByTestId("panel-live-lv")).toHaveTextContent(/live/i);
    FakeEventSource.instances[0]!.emit("notification", { kind: "deadline" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["panel-data", "/api/live"] });
  });

  it("ignores an event whose kind isn't in liveOn", () => {
    const client = seededLiveClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const panel: Panel = { id: "lv2", kind: "metric", source: { url: "/api/live", live: true, liveOn: ["assignment"] } };
    renderWithProviders(<BoundPanel panel={panel} render={renderInner} />, { client });

    FakeEventSource.instances[0]!.emit("notification", { kind: "deadline" }); // not in liveOn
    expect(spy).not.toHaveBeenCalled();
  });

  it("omits the LIVE badge for a non-live sourced panel", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    client.setQueryData(["panel-data", "/api/static"], { value: 2 });
    const spy = vi.spyOn(client, "invalidateQueries");
    const panel: Panel = { id: "st", kind: "metric", source: { url: "/api/static" } };
    renderWithProviders(<BoundPanel panel={panel} render={renderInner} />, { client });

    expect(screen.queryByTestId("panel-live-st")).not.toBeInTheDocument();
    FakeEventSource.instances[0]!.emit("notification", { kind: "deadline" });
    expect(spy).not.toHaveBeenCalled(); // source.live is off ⇒ no revalidation
  });
});
