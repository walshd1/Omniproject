import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ScreenRenderer } from "./ScreenRenderer";
import type { ScreenDef } from "../../lib/screen";

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
