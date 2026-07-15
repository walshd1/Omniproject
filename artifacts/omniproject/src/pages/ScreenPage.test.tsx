import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";

/**
 * ScreenPage is the ONE generic builder: given a screen id it loads that JSON def and renders it through
 * the EditableScreen canvas. These prove the data-driven path end-to-end for the budget-plans screen
 * (heading + label from JSON, one bound panel per JSON panel, PMO edit affordance) and the unknown-id guard.
 */
vi.mock("../lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role: "pmo" } }) };
});
vi.mock("../lib/screen-layouts", () => ({
  useScreenLayouts: () => ({ data: {} }),
  useSaveScreenLayouts: () => ({ mutate: vi.fn(), isPending: false }),
}));
// Stub the hosted-component registry so the bare-screen test doesn't pull in real pages.
vi.mock("../components/screen/screen-components", () => ({
  SCREEN_COMPONENTS: {
    tasks: () => <div data-testid="hosted-tasks">tasks page</div>,
    "project-detail": (props: { projectId?: string }) => <div data-testid="hosted-detail">detail {props.projectId ?? "?"}</div>,
  },
  hasScreenComponent: (id: string) => id === "tasks" || id === "project-detail",
}));

const { ScreenPage } = await import("./ScreenPage");

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ rows: [] }) })) as unknown as typeof fetch);
});

describe("ScreenPage (generic builder)", () => {
  it("renders the budget-plans screen from its JSON definition", () => {
    renderWithProviders(<ScreenPage id="budget-plans" />);
    expect(screen.getByRole("heading", { name: /budget plans/i })).toBeTruthy();
    expect(screen.getByTestId("editable-screen-budget-plans")).toBeTruthy();
  });

  it("renders one bound panel per JSON panel", () => {
    renderWithProviders(<ScreenPage id="budget-plans" />);
    expect(screen.getByTestId("bound-panel-budget-by-year")).toBeTruthy();
    expect(screen.getByTestId("bound-panel-budget-by-project")).toBeTruthy();
    expect(screen.getByTestId("bound-panel-budget-all-periods")).toBeTruthy();
  });

  it("offers the PMO the Edit layout affordance", () => {
    renderWithProviders(<ScreenPage id="budget-plans" />);
    expect(screen.getByTestId("edit-layout")).toBeTruthy();
  });

  it("shows a guard for an unknown screen id", () => {
    renderWithProviders(<ScreenPage id="no-such-screen" />);
    expect(screen.getByTestId("screen-unknown-no-such-screen")).toBeTruthy();
  });

  it("renders a bare component-host screen full-bleed (no header chrome, no layout editor)", () => {
    renderWithProviders(<ScreenPage id="tasks" />);
    expect(screen.getByTestId("screen-tasks")).toBeTruthy();
    expect(screen.getByTestId("hosted-tasks")).toBeTruthy();
    // Bare single-panel host: no ScreenPage <h1> title and no edit affordance to clutter it.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByTestId("edit-layout")).toBeNull();
  });

  it("threads a route param into a hosted detail component", () => {
    renderWithProviders(<ScreenPage id="project-detail" params={{ projectId: "proj-42" }} />);
    expect(screen.getByTestId("hosted-detail").textContent).toContain("proj-42");
  });
});
