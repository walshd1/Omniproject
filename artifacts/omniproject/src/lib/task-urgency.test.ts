import { describe, it, expect } from "vitest";
import { taskUrgency, isUntouched, daysUntilDue, taskAttention } from "./task-urgency";

const TODAY = new Date(Date.UTC(2026, 1, 11)); // 2026-02-11

describe("task-urgency", () => {
  it("bands a task by its due date", () => {
    expect(taskUrgency({ dueDate: "2026-02-05" }, TODAY)).toBe("overdue");
    expect(taskUrgency({ dueDate: "2026-02-11" }, TODAY)).toBe("due-today");
    expect(taskUrgency({ dueDate: "2026-02-13" }, TODAY)).toBe("due-soon"); // within 3 days
    expect(taskUrgency({ dueDate: "2026-03-01" }, TODAY)).toBe("scheduled");
    expect(taskUrgency({}, TODAY)).toBe("none"); // no due date
  });

  it("a closed task is never urgent", () => {
    expect(taskUrgency({ dueDate: "2026-02-05", completedAt: "2026-02-06" }, TODAY)).toBe("none");
    expect(taskUrgency({ dueDate: "2026-02-05", status: "done" }, TODAY)).toBe("none");
  });

  it("daysUntilDue is signed (negative = overdue), null with no due date", () => {
    expect(daysUntilDue({ dueDate: "2026-02-14" }, TODAY)).toBe(3);
    expect(daysUntilDue({ dueDate: "2026-02-09" }, TODAY)).toBe(-2);
    expect(daysUntilDue({}, TODAY)).toBeNull();
  });

  it("flags an untouched OPEN task past the stale window, but not closed or un-timestamped ones", () => {
    expect(isUntouched({ updatedAt: "2026-01-20", status: "next" }, TODAY)).toBe(true);  // 22 days
    expect(isUntouched({ updatedAt: "2026-02-08", status: "next" }, TODAY)).toBe(false); // 3 days
    expect(isUntouched({ updatedAt: "2026-01-01", status: "done" }, TODAY)).toBe(false); // closed
    expect(isUntouched({ status: "next" }, TODAY)).toBe(false);                          // no timestamp → never flag
    expect(isUntouched({ createdAt: "2026-01-01", status: "next" }, TODAY)).toBe(true);  // falls back to createdAt
  });

  it("taskAttention rolls band + untouched + days into one read", () => {
    expect(taskAttention({ dueDate: "2026-02-09", updatedAt: "2026-01-10", status: "next" }, TODAY)).toEqual({
      band: "overdue", untouched: true, daysUntilDue: -2,
    });
  });
});
