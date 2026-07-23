import { describe, it, expect } from "vitest";
import { fieldPresent, evaluateEntry, hardViolations, type EntryRequirement } from "./entry-rules";

const reqPriorityTask: EntryRequirement = { rule: "require-priority", action: "create_task", field: "priority", mode: "hard", message: "A priority is required (business rule)." };
const reqAssigneeIssue: EntryRequirement = { rule: "require-assignee", action: "create_issue", field: "assignee", mode: "warn", message: "An assignee is required." };
const depCostCentre: EntryRequirement = { rule: "cc", action: "create_issue", field: "costCenter", mode: "hard", message: "costCenter required when billable", whenPresent: "billable" };

describe("fieldPresent", () => {
  it("treats null/undefined/empty/whitespace as absent", () => {
    for (const v of [null, undefined, "", "   "]) expect(fieldPresent("x", v)).toBe(false);
  });
  it("treats an empty array as absent, a non-empty one as present", () => {
    expect(fieldPresent("labels", [])).toBe(false);
    expect(fieldPresent("labels", ["a"])).toBe(true);
  });
  it("treats priority 'none' (any case/space) as absent, a real level as present", () => {
    expect(fieldPresent("priority", "none")).toBe(false);
    expect(fieldPresent("priority", "  NONE ")).toBe(false);
    expect(fieldPresent("priority", "high")).toBe(true);
  });
  it("does NOT special-case 'none' for other fields", () => {
    expect(fieldPresent("status", "none")).toBe(true);
  });
});

describe("evaluateEntry", () => {
  it("flags a missing hard field for the matching action only", () => {
    expect(evaluateEntry({ title: "x" }, [reqPriorityTask], "create_task")).toEqual([
      { field: "priority", mode: "hard", message: reqPriorityTask.message, rule: "require-priority" },
    ]);
    // wrong action → no violation
    expect(evaluateEntry({ title: "x" }, [reqPriorityTask], "create_issue")).toEqual([]);
  });

  it("is satisfied by a real value (incl. treating priority 'none' as missing)", () => {
    expect(evaluateEntry({ title: "x", priority: "high" }, [reqPriorityTask], "create_task")).toEqual([]);
    expect(evaluateEntry({ title: "x", priority: "none" }, [reqPriorityTask], "create_task")).toHaveLength(1);
  });

  it("separates warn nudges from hard blocks", () => {
    const v = evaluateEntry({ title: "x" }, [reqPriorityTask, reqAssigneeIssue], "create_issue");
    expect(v).toHaveLength(1); // only the issue assignee (warn); the task-priority rule is a different action
    expect(v[0]!.mode).toBe("warn");
    expect(hardViolations(evaluateEntry({ title: "x" }, [reqPriorityTask], "create_task"))).toHaveLength(1);
  });

  it("only enforces a dependency rule when its trigger field is present", () => {
    expect(evaluateEntry({ title: "x" }, [depCostCentre], "create_issue")).toEqual([]); // billable absent
    expect(evaluateEntry({ title: "x", billable: true }, [depCostCentre], "create_issue")).toHaveLength(1);
    expect(evaluateEntry({ title: "x", billable: true, costCenter: "CC-1" }, [depCostCentre], "create_issue")).toEqual([]);
  });

  it("returns nothing when requirements are undefined (rules not loaded yet)", () => {
    expect(evaluateEntry({ title: "x" }, undefined, "create_task")).toEqual([]);
  });
});
