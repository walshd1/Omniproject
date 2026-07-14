import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  WIDGET_CATALOGUE,
  widgetDef,
  clampSpan,
  availableWidgets,
  availablePresets,
  presetForRole,
  dashboardFromPreset,
  useDashboards,
  useSaveDashboards,
  dashboardsQueryKey,
  type Dashboard,
  type DashboardPreset,
} from "./dashboards";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

afterEach(() => vi.restoreAllMocks());

describe("WIDGET_CATALOGUE", () => {
  it("has unique widget types and non-empty metadata", () => {
    const types = WIDGET_CATALOGUE.map((w) => w.type);
    expect(new Set(types).size).toBe(types.length);
    for (const w of WIDGET_CATALOGUE) {
      expect(w.label).toBeTruthy();
      expect(w.description).toBeTruthy();
      expect([1, 2, 3]).toContain(w.defaultSpan);
    }
  });
});

describe("widgetDef", () => {
  it("resolves a known type and returns undefined for an unknown one", () => {
    expect(widgetDef("portfolioHealth")?.label).toBe("Portfolio health");
    expect(widgetDef("nope")).toBeUndefined();
  });
});

describe("clampSpan", () => {
  it("normalises to the 1–3 grid", () => {
    expect(clampSpan(undefined)).toBe(1);
    expect(clampSpan(0)).toBe(1);
    expect(clampSpan(1)).toBe(1);
    expect(clampSpan(2)).toBe(2);
    expect(clampSpan(3)).toBe(3);
    expect(clampSpan(9)).toBe(3);
  });
});

describe("availableWidgets", () => {
  it("drops entity-gated widgets the backend can't surface", () => {
    const without = availableWidgets((entity) => entity !== "programme");
    expect(without.some((w) => w.type === "programmeCount")).toBe(false);
    expect(without.some((w) => w.type === "portfolioHealth")).toBe(true);
  });

  it("keeps every widget when the backend surfaces everything", () => {
    const all = availableWidgets(() => true);
    expect(all.length).toBe(WIDGET_CATALOGUE.length);
  });
});

describe("dashboard presets", () => {
  it("offers a preset per role, tailored to the role", () => {
    const all = availablePresets(() => true);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(presetForRole("head-of-projects")?.role).toBe("head-of-projects");
    expect(presetForRole("nope")).toBeUndefined();
  });

  it("drops a preset needing an entity the backend can't surface", () => {
    const without = availablePresets((entity) => entity !== "programme");
    expect(without.some((p) => p.role === "programme-manager")).toBe(false);
    expect(without.some((p) => p.role === "project-manager")).toBe(true);
  });

  it("materialises a preset into a fresh, persistable dashboard", () => {
    const preset = presetForRole("project-manager")!;
    const dash = dashboardFromPreset(preset);
    expect(dash.id).toBe(""); // caller mints the id
    expect(dash.name).toBe(preset.name);
    expect(dash.widgets.length).toBe(preset.widgets.length);
    // Every placed widget gets a fresh unique id and a resolved span.
    const ids = dash.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of dash.widgets) expect([1, 2, 3]).toContain(w.span);
  });

  it("resolves each widget's span and title across the fallback chain", () => {
    const known = WIDGET_CATALOGUE[0]!;
    const preset = {
      role: "custom",
      name: "Synthetic",
      widgets: [
        { type: "unknownWidgetType" },                 // span → widgetDef undefined → 1; no title
        { type: known.type, title: "Renamed" },        // span → known.defaultSpan; title kept
        { type: known.type, span: 2 as const },         // explicit span wins
      ],
    } as unknown as DashboardPreset;

    const dash = dashboardFromPreset(preset);
    expect(dash.name).toBe("Synthetic");
    expect(dash.widgets[0]!.span).toBe(1);
    expect(dash.widgets[0]!.title).toBeUndefined();
    expect(dash.widgets[1]!.span).toBe(known.defaultSpan);
    expect(dash.widgets[1]!.title).toBe("Renamed");
    expect(dash.widgets[2]!.span).toBe(2);
  });
});

describe("useDashboards", () => {
  it("unwraps the dashboards array from the envelope", async () => {
    const dashboards: Dashboard[] = [{ id: "d1", name: "Ops", widgets: [] }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ dashboards }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDashboards(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toEqual(dashboards);
  });
});

describe("useSaveDashboards", () => {
  it("PUTs the full list and invalidates the dashboards query on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveDashboards(), { wrapper: wrapper(client) });
    result.current.mutate([{ id: "d1", name: "Ops", widgets: [] }]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(url).toBe("/api/dashboards");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(String((opts as RequestInit).body)).toContain("dashboards");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dashboardsQueryKey });
  });

  it("surfaces the server error when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result } = renderHook(() => useSaveDashboards(), { wrapper: wrapper(client) });
    result.current.mutate([]);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
