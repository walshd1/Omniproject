import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../../test/utils";
import { ScreenRenderer } from "../ScreenRenderer";
import type { ScreenDef } from "../../../lib/screen";

/**
 * ViewPanel tests — the bridge that hosts an existing methodology view as a panel,
 * so a screen of panels can embed the real board/Gantt/etc. through one renderer.
 */

function seededWithIssue(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("proj-1"), [
    { id: "iss-1", projectId: "proj-1", title: "Build the thing", status: "in_progress", priority: "none", labels: [], source: "jira" } as unknown as Issue,
  ]);
  return qc;
}

describe("ViewPanel (via ScreenRenderer)", () => {
  it("hosts the Kanban board as a panel and renders its issues", () => {
    const s: ScreenDef = { id: "project", label: "Project", panels: [{ id: "b", kind: "view", config: { view: "kanban", projectId: "proj-1" } }] };
    renderWithProviders(<ScreenRenderer screen={s} />, { client: seededWithIssue() });
    expect(screen.getByTestId("view-panel")).toHaveAttribute("data-view", "kanban");
    expect(screen.getByText("Build the thing")).toBeInTheDocument(); // the real board rendered
  });

  it("degrades an unknown view id to a placeholder", () => {
    const s: ScreenDef = { id: "x", label: "X", panels: [{ id: "v", kind: "view", config: { view: "nope", projectId: "proj-1" } }] };
    renderWithProviders(<ScreenRenderer screen={s} />);
    expect(screen.getByTestId("unknown-view")).toBeInTheDocument();
  });

  it("defaults view and projectId to empty when the panel has no config, showing the placeholder", () => {
    const s: ScreenDef = { id: "x2", label: "X2", panels: [{ id: "v2", kind: "view" }] };
    renderWithProviders(<ScreenRenderer screen={s} />);
    // config.view defaults to "" ⇒ not a known view id ⇒ placeholder for the empty view name.
    expect(screen.getByTestId("unknown-view")).toHaveTextContent("Unknown view");
  });
});
