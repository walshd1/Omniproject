import { describe, it, expect } from "vitest";
import { VIEWS, DEFAULT_VIEW, isViewId, nextView, viewMeta, type ViewId } from "./views";

const ALL_IDS: ViewId[] = ["kanban", "scrum", "gantt", "prince2", "raid", "list"];

describe("VIEWS registry", () => {
  it("lists all six views with unique ids", () => {
    expect(VIEWS.map((v) => v.id)).toEqual(ALL_IDS);
    expect(new Set(VIEWS.map((v) => v.id)).size).toBe(VIEWS.length);
  });

  it("each view has label, short, group, methodology and description", () => {
    for (const v of VIEWS) {
      expect(v.label).toBeTruthy();
      expect(v.short).toBeTruthy();
      expect(v.group).toBeTruthy();
      expect(v.methodology).toBeTruthy();
      expect(v.description).toBeTruthy();
    }
  });

  it("only gantt and raid declare capability needs", () => {
    expect(VIEWS.find((v) => v.id === "gantt")!.needs).toBe("scheduling");
    expect(VIEWS.find((v) => v.id === "raid")!.needs).toBe("raid");
    expect(VIEWS.find((v) => v.id === "kanban")!.needs).toBeUndefined();
  });

  it("DEFAULT_VIEW is kanban", () => {
    expect(DEFAULT_VIEW).toBe("kanban");
  });
});

describe("isViewId", () => {
  it("accepts every known id", () => {
    for (const id of ALL_IDS) expect(isViewId(id)).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isViewId("calendar")).toBe(false);
    expect(isViewId("")).toBe(false);
  });
});

describe("nextView", () => {
  it("cycles forward through the registry order", () => {
    expect(nextView("kanban")).toBe("scrum");
    expect(nextView("scrum")).toBe("gantt");
    expect(nextView("list")).toBe("kanban"); // wraps
  });
});

describe("viewMeta", () => {
  it("returns the matching meta", () => {
    expect(viewMeta("scrum").label).toBe("Scrum Sprint");
  });

  it("falls back to the first view for an unknown id", () => {
    expect(viewMeta("nope" as ViewId).id).toBe("kanban");
  });
});
