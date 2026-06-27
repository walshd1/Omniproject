import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ScreenRenderer } from "./ScreenRenderer";
import type { ScreenDef } from "../../lib/screen";

/**
 * BoundPanel: a live panel shows the live badge; a still-loading panel shows a
 * progressive skeleton instead of blocking.
 */
afterEach(() => vi.unstubAllGlobals());

function seeded(data: unknown): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(["panel-data", "/api/g"], data);
  return qc;
}

describe("BoundPanel live + progressive", () => {
  it("shows a 'live' badge when the panel opts into live refresh", () => {
    const client = seeded({ nodes: [{ id: "a" }], edges: [] });
    const s: ScreenDef = {
      id: "v", label: "V",
      panels: [{ id: "g", kind: "graph", title: "Deps", source: { url: "/api/g", live: true }, config: {} }],
    };
    renderWithProviders(<ScreenRenderer screen={s} />, { client });
    expect(screen.getByTestId("panel-live-g")).toBeInTheDocument();
  });

  it("shows a skeleton while the panel's data is still loading", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {})); // never resolves ⇒ stays loading
    const s: ScreenDef = {
      id: "v", label: "V",
      panels: [{ id: "g", kind: "graph", title: "Deps", source: { url: "/api/g" }, config: {} }],
    };
    renderWithProviders(<ScreenRenderer screen={s} />); // fresh client ⇒ no seeded data
    expect(screen.getByTestId("panel-skeleton-g")).toBeInTheDocument();
  });
});
