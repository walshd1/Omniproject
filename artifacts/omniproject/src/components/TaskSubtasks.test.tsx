import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TaskSubtasks } from "./TaskSubtasks";
import type { Task } from "../lib/tasks";

/**
 * TaskSubtasks — the create/re-parent front door for the subtask tree. We mock the task hooks and assert the
 * children list, the "add subtask" create (linked to the parent), and that the re-parent picker excludes the
 * task's own subtree (no cycles).
 */
const create = vi.fn();
const update = vi.fn();
let tasks: Task[] = [];

vi.mock("../lib/tasks", async (orig) => ({
  ...(await orig<typeof import("../lib/tasks")>()),
  useTasks: () => ({ data: tasks }),
  useCreateTask: () => ({ mutate: create, isPending: false }),
  useUpdateTask: () => ({ mutate: update, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const t = (over: Partial<Task> & { id: string }): Task => ({ title: over.id, status: "next", ...over });
const wrap = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

describe("TaskSubtasks", () => {
  beforeEach(() => { vi.clearAllMocks(); tasks = []; });

  it("lists the task's existing children", () => {
    const parent = t({ id: "p", title: "Parent" });
    tasks = [parent, t({ id: "c1", title: "Child one", parentTaskId: "p" }), t({ id: "other", title: "Other" })];
    wrap(<TaskSubtasks task={parent} />);
    // The child renders as a clickable row in the children list …
    expect(screen.getByRole("button", { name: "Child one" })).toBeInTheDocument();
    // … while a non-child never appears as a child row (it may still be a re-parent option).
    expect(screen.queryByRole("button", { name: "Other" })).not.toBeInTheDocument();
  });

  it("adds a subtask linked to the parent (and its project)", async () => {
    const parent = t({ id: "p", title: "Parent", projectId: "proj-1" });
    tasks = [parent];
    wrap(<TaskSubtasks task={parent} />);
    fireEvent.change(screen.getByLabelText("New subtask title"), { target: { value: "Do the thing" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Do the thing", parentTaskId: "p", projectId: "proj-1" }),
      expect.any(Object),
    ));
  });

  it("re-parent picker excludes the task itself and its descendants", () => {
    const parent = t({ id: "p", title: "Parent" });
    tasks = [parent, t({ id: "c", title: "Child", parentTaskId: "p" }), t({ id: "g", title: "Grandchild", parentTaskId: "c" }), t({ id: "free", title: "Free" })];
    wrap(<TaskSubtasks task={parent} />);
    const select = screen.getByLabelText("Parent task") as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain("free");
    expect(opts).not.toContain("p"); // self
    expect(opts).not.toContain("c"); // descendant
    expect(opts).not.toContain("g"); // descendant
  });

  it("re-parents this task when a parent is chosen", () => {
    const parent = t({ id: "p", title: "Parent" });
    tasks = [parent, t({ id: "free", title: "Free" })];
    wrap(<TaskSubtasks task={parent} />);
    fireEvent.change(screen.getByLabelText("Parent task"), { target: { value: "free" } });
    expect(update).toHaveBeenCalledWith({ id: "p", patch: { parentTaskId: "free" } });
  });
});
