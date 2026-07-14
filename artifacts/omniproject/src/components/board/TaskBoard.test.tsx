import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { TaskBoard } from "./TaskBoard";
import type { Task } from "../../lib/tasks";

const TASKS: Task[] = [
  { id: "a", title: "Call auditor", status: "next" },
  { id: "b", title: "Chase DPA", status: "waiting", waitingOn: "Legal" },
];

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(() => Promise.resolve(json({}))); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("TaskBoard", () => {
  it("renders the classic GTD columns with the cards in the right column", () => {
    renderWithProviders(<TaskBoard tasks={TASKS} onOpen={() => {}} />);
    // Columns carry their GTD label as an aria-label on the column body.
    expect(screen.getByLabelText("Next Actions")).toBeInTheDocument();
    expect(screen.getByLabelText("Someday / Maybe")).toBeInTheDocument();
    // "Chase DPA" sits under the Waiting For column; "Call auditor" does not.
    const waitingCol = screen.getByLabelText("Waiting For");
    expect(within(waitingCol).getByText("Chase DPA")).toBeInTheDocument();
    expect(within(waitingCol).queryByText("Call auditor")).not.toBeInTheDocument();
  });

  it("moving a card via its selector PATCHes the new GTD status", async () => {
    renderWithProviders(<TaskBoard tasks={TASKS} onOpen={() => {}} />);
    fireEvent.change(screen.getByLabelText("Move Call auditor"), { target: { value: "done" } });
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/tasks/a") && c[1]?.method === "PATCH");
      expect(JSON.parse(String(patch![1].body)).status).toBe("done");
    });
  });

  it("opens a card's detail on title click", () => {
    const onOpen = vi.fn();
    renderWithProviders(<TaskBoard tasks={TASKS} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Call auditor"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("renders context, assignee, due-date and waiting-on chips plus the priority badge", () => {
    const rich: Task[] = [
      {
        id: "c",
        title: "Prep board pack",
        status: "next",
        priority: "high",
        context: "@office",
        assignee: "Grace",
        dueDate: "2030-02-01",
        waitingOn: "CFO",
      },
    ];
    renderWithProviders(<TaskBoard tasks={rich} onOpen={() => {}} />);
    const card = screen.getByText("Prep board pack").closest("div")!;
    expect(within(card).getByText("@office")).toBeInTheDocument();
    expect(within(card).getByText(/Grace/)).toBeInTheDocument();
    expect(within(card).getByText(/due 2030-02-01/)).toBeInTheDocument();
    expect(within(card).getByText(/waiting on CFO/)).toBeInTheDocument();
    // priority is mapped through usePriorityLabels → the badge shows the canonical label ("high").
    expect(within(card).getByText("high")).toBeInTheDocument();
  });

  it("does not PATCH when a card is 'moved' to the status it already has", async () => {
    renderWithProviders(<TaskBoard tasks={TASKS} onOpen={() => {}} />);
    // "Call auditor" is already in "next"; selecting next again is a no-op guarded before mutate.
    fireEvent.change(screen.getByLabelText("Move Call auditor"), { target: { value: "next" } });
    // Nothing PATCHes /tasks/a (usePriorityLabels still does its own GET, so we check the write only).
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/tasks/") && c[1]?.method === "PATCH"),
      ).toBe(false);
    });
  });
});
