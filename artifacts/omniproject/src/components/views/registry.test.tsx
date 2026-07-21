import { describe, it, expect } from "vitest";
import { VIEW_COMPONENTS } from "./registry";
import { VIEWS } from "../../lib/views";
import { GanttChart } from "../board/GanttChart";
import { ScrumView } from "./ScrumView";
import { Prince2View } from "./Prince2View";
import { RaidView } from "./RaidView";
import { IssueBoardView, IssueListView, IssueEngineView } from "./IssueEngineView";

describe("VIEW_COMPONENTS registry", () => {
  it("maps every registered view id to a renderer", () => {
    for (const meta of VIEWS) {
      expect(VIEW_COMPONENTS[meta.id]).toBeTypeOf("function");
    }
  });

  it("wires each id to the expected component", () => {
    // kanban / list / flow all render issues through the ONE generic engine (bespoke AgileBoard/
    // ListView retired); the rest keep their specialized renderers.
    expect(VIEW_COMPONENTS.kanban).toBe(IssueBoardView);
    expect(VIEW_COMPONENTS.list).toBe(IssueListView);
    expect(VIEW_COMPONENTS.flow).toBe(IssueEngineView);
    expect(VIEW_COMPONENTS.scrum).toBe(ScrumView);
    expect(VIEW_COMPONENTS.gantt).toBe(GanttChart);
    expect(VIEW_COMPONENTS.prince2).toBe(Prince2View);
    expect(VIEW_COMPONENTS.raid).toBe(RaidView);
  });

  it("has exactly one entry per declared view id and no extras", () => {
    const registryIds = Object.keys(VIEW_COMPONENTS).sort();
    const declaredIds = VIEWS.map((v) => v.id).sort();
    expect(registryIds).toEqual(declaredIds);
  });
});
