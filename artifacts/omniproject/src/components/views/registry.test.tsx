import { describe, it, expect } from "vitest";
import { VIEW_COMPONENTS } from "./registry";
import { VIEWS } from "../../lib/views";
import { AgileBoard } from "../board/AgileBoard";
import { GanttChart } from "../board/GanttChart";
import { ScrumView } from "./ScrumView";
import { Prince2View } from "./Prince2View";
import { RaidView } from "./RaidView";
import { ListView } from "./ListView";

describe("VIEW_COMPONENTS registry", () => {
  it("maps every registered view id to a renderer", () => {
    for (const meta of VIEWS) {
      expect(VIEW_COMPONENTS[meta.id]).toBeTypeOf("function");
    }
  });

  it("wires each id to the expected component", () => {
    expect(VIEW_COMPONENTS.kanban).toBe(AgileBoard);
    expect(VIEW_COMPONENTS.scrum).toBe(ScrumView);
    expect(VIEW_COMPONENTS.gantt).toBe(GanttChart);
    expect(VIEW_COMPONENTS.prince2).toBe(Prince2View);
    expect(VIEW_COMPONENTS.raid).toBe(RaidView);
    expect(VIEW_COMPONENTS.list).toBe(ListView);
  });

  it("has exactly one entry per declared view id and no extras", () => {
    const registryIds = Object.keys(VIEW_COMPONENTS).sort();
    const declaredIds = VIEWS.map((v) => v.id).sort();
    expect(registryIds).toEqual(declaredIds);
  });
});
