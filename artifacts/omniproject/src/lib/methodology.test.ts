import { describe, it, expect, vi, afterEach } from "vitest";
import type { Issue } from "@workspace/api-client-react";
import {
  isDone,
  isTerminal,
  isOverdue,
  storyPoints,
  explicitSprint,
  explicitStage,
  inActiveSprint,
  SPRINT_COLUMNS,
  WIP_LIMITS,
  PRINCE2_STAGES,
  prince2Stage,
  ragFor,
  RAG_DOT,
  RAG_TEXT,
  completion,
} from "./methodology";

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    projectId: "p1",
    title: "t",
    status: "todo",
    priority: "medium",
    labels: [],
    source: "test",
    createdAt: "2020-01-01T00:00:00Z",
    updatedAt: "2020-01-01T00:00:00Z",
    ...over,
  } as Issue;
}

afterEach(() => vi.useRealTimers());

describe("isDone / isTerminal", () => {
  it("isDone is true only for done", () => {
    expect(isDone("done")).toBe(true);
    expect(isDone("cancelled")).toBe(false);
    expect(isDone("in_progress")).toBe(false);
  });

  it("isTerminal covers done and cancelled", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("todo")).toBe(false);
  });
});

describe("isOverdue", () => {
  it("false when no due date", () => {
    expect(isOverdue(issue({ dueDate: null }))).toBe(false);
  });

  it("true when due date past and not terminal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T00:00:00Z"));
    expect(isOverdue(issue({ dueDate: "2020-01-01", status: "in_progress" }))).toBe(true);
  });

  it("false when overdue but terminal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T00:00:00Z"));
    expect(isOverdue(issue({ dueDate: "2020-01-01", status: "done" }))).toBe(false);
    expect(isOverdue(issue({ dueDate: "2020-01-01", status: "cancelled" }))).toBe(false);
  });

  it("false when due date is in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T00:00:00Z"));
    expect(isOverdue(issue({ dueDate: "2099-01-01", status: "todo" }))).toBe(false);
  });
});

describe("storyPoints", () => {
  it("reads an explicit sp: label", () => {
    expect(storyPoints(issue({ labels: ["sp:13"] }))).toBe(13);
  });

  it("reads pts/points label variants", () => {
    expect(storyPoints(issue({ labels: ["points: 21"] }))).toBe(21);
    expect(storyPoints(issue({ labels: ["pt-5"] }))).toBe(5);
  });

  it("falls back to priority weighting when no label", () => {
    expect(storyPoints(issue({ priority: "urgent", labels: [] }))).toBe(8);
    expect(storyPoints(issue({ priority: "high", labels: [] }))).toBe(5);
    expect(storyPoints(issue({ priority: "medium", labels: [] }))).toBe(3);
    expect(storyPoints(issue({ priority: "low", labels: [] }))).toBe(2);
    expect(storyPoints(issue({ priority: "none", labels: [] }))).toBe(1);
  });

  it("falls back to 1 for an unknown priority", () => {
    expect(storyPoints(issue({ priority: "mystery" as Issue["priority"], labels: [] }))).toBe(1);
  });
});

describe("explicitSprint / explicitStage", () => {
  it("extracts sprint and iteration names", () => {
    expect(explicitSprint(issue({ labels: ["sprint: Alpha"] }))).toBe("Alpha");
    expect(explicitSprint(issue({ labels: ["iteration-7"] }))).toBe("7");
  });

  it("returns null when no sprint label", () => {
    expect(explicitSprint(issue({ labels: ["frontend"] }))).toBeNull();
  });

  it("extracts stage names", () => {
    expect(explicitStage(issue({ labels: ["stage: Delivery"] }))).toBe("Delivery");
    expect(explicitStage(issue({ labels: ["other"] }))).toBeNull();
  });
});

describe("inActiveSprint", () => {
  it("true with an explicit sprint label regardless of status", () => {
    expect(inActiveSprint(issue({ status: "backlog", labels: ["sprint:1"] }))).toBe(true);
  });

  it("true for committed statuses", () => {
    expect(inActiveSprint(issue({ status: "todo" }))).toBe(true);
    expect(inActiveSprint(issue({ status: "in_progress" }))).toBe(true);
    expect(inActiveSprint(issue({ status: "in_review" }))).toBe(true);
  });

  it("false for backlog/done without a sprint label", () => {
    expect(inActiveSprint(issue({ status: "backlog" }))).toBe(false);
    expect(inActiveSprint(issue({ status: "done" }))).toBe(false);
  });
});

describe("static tables", () => {
  it("SPRINT_COLUMNS, WIP_LIMITS, PRINCE2_STAGES", () => {
    expect(SPRINT_COLUMNS).toEqual(["todo", "in_progress", "in_review", "done"]);
    expect(WIP_LIMITS).toEqual({ in_progress: 4, in_review: 3 });
    expect(PRINCE2_STAGES).toEqual(["Initiation", "Delivery", "Closure"]);
  });
});

describe("prince2Stage", () => {
  it("prefers an explicit stage label", () => {
    expect(prince2Stage(issue({ status: "done", labels: ["stage:Custom"] }))).toBe("Custom");
  });

  it("maps status to a stage", () => {
    expect(prince2Stage(issue({ status: "backlog" }))).toBe("Initiation");
    expect(prince2Stage(issue({ status: "todo" }))).toBe("Initiation");
    expect(prince2Stage(issue({ status: "in_progress" }))).toBe("Delivery");
    expect(prince2Stage(issue({ status: "in_review" }))).toBe("Delivery");
    expect(prince2Stage(issue({ status: "done" }))).toBe("Closure");
    expect(prince2Stage(issue({ status: "cancelled" }))).toBe("Closure");
  });
});

describe("ragFor", () => {
  it("RED for 3+ overdue or <25% complete", () => {
    expect(ragFor(90, 3)).toBe("RED");
    expect(ragFor(10, 0)).toBe("RED");
  });

  it("AMBER for any overdue or <60% complete", () => {
    expect(ragFor(90, 1)).toBe("AMBER");
    expect(ragFor(40, 0)).toBe("AMBER");
  });

  it("GREEN otherwise", () => {
    expect(ragFor(80, 0)).toBe("GREEN");
    expect(ragFor(60, 0)).toBe("GREEN");
  });

  it("boundary: 25% is not RED but is AMBER", () => {
    expect(ragFor(25, 0)).toBe("AMBER");
  });

  it("RAG_DOT / RAG_TEXT have all three keys", () => {
    expect(RAG_DOT.GREEN).toBe("bg-green-500");
    expect(RAG_TEXT.RED).toBe("text-red-500");
    expect(RAG_DOT.AMBER).toBe("bg-amber-500");
  });
});

describe("completion", () => {
  it("returns 0 for empty list", () => {
    expect(completion([])).toBe(0);
  });

  it("rounds done/total percentage", () => {
    const list = [
      issue({ status: "done" }),
      issue({ status: "done" }),
      issue({ status: "todo" }),
    ];
    expect(completion(list)).toBe(67);
  });

  it("100% when all done", () => {
    expect(completion([issue({ status: "done" }), issue({ status: "done" })])).toBe(100);
  });
});
