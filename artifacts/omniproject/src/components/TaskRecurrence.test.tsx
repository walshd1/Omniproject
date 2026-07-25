import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskRecurrence } from "./TaskRecurrence";
import type { Task } from "../lib/tasks";

/**
 * TaskRecurrence — the repeat-rule authoring control. We mock useUpdateTask and assert the preset patch,
 * clearing to one-off, and a custom free-text rule. The recurrence maths itself lives server-side.
 */
const update = vi.fn();
vi.mock("../lib/tasks", async (orig) => ({
  ...(await orig<typeof import("../lib/tasks")>()),
  useUpdateTask: () => ({ mutate: update, isPending: false }),
}));

const task = (over: Partial<Task> = {}): Task => ({ id: "t1", title: "T", status: "next", ...over });

describe("TaskRecurrence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a preset sets the corresponding rule", () => {
    render(<TaskRecurrence task={task()} />);
    fireEvent.click(screen.getByRole("button", { name: "Weekdays" }));
    expect(update).toHaveBeenCalledWith({ id: "t1", patch: { recurrence: "every weekday" } });
  });

  it("'Never' clears the rule to null (one-off)", () => {
    render(<TaskRecurrence task={task({ recurrence: "every week" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Never" }));
    expect(update).toHaveBeenCalledWith({ id: "t1", patch: { recurrence: null } });
  });

  it("a custom free-text rule is saved via Set", () => {
    render(<TaskRecurrence task={task()} />);
    fireEvent.change(screen.getByLabelText("Recurrence rule"), { target: { value: "every 2 weeks" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(update).toHaveBeenCalledWith({ id: "t1", patch: { recurrence: "every 2 weeks" } });
  });

  it("marks the active preset as pressed", () => {
    render(<TaskRecurrence task={task({ recurrence: "every week" })} />);
    expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Never" })).toHaveAttribute("aria-pressed", "false");
  });
});
