import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { Tasks } from "./Tasks";
import type { Task } from "../../lib/tasks";

const SUMMARY = { total: 3, byClass: { actionable: 1, waiting: 1, deferred: 0, done: 1, dropped: 0 }, open: 2, actionable: 1, overdue: 1, dueSoon: 0, unassigned: 1, byAssignee: {}, byTag: {}, byContext: {} };
let tasks: Task[] = [
  { id: "task-1", title: "Call the auditor", status: "next", context: "@calls", assignee: "pat@demo", dueDate: "2026-08-01" },
  { id: "task-2", title: "Chase the DPA", status: "waiting", waitingOn: "Legal" },
];

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/tasks" && init?.method === "POST") { tasks = [...tasks, { id: "task-3", title: JSON.parse(String(init.body)).title, status: "next" }]; return Promise.resolve(json(tasks[tasks.length - 1])); }
    if (url.startsWith("/api/tasks/summary")) return Promise.resolve(json(SUMMARY));
    if (url.startsWith("/api/tasks")) return Promise.resolve(json(tasks));
    return Promise.resolve(json({}, false));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Tasks", () => {
  it("shows the summary strip and the task list", async () => {
    renderWithProviders(<Tasks />);
    expect(await screen.findByText("Call the auditor")).toBeInTheDocument();
    expect(screen.getByText("Chase the DPA")).toBeInTheDocument();
    expect(screen.getByText("Actionable")).toBeInTheDocument();
  });

  it("filtering by status narrows the list", async () => {
    renderWithProviders(<Tasks />);
    await screen.findByText("Call the auditor");
    fireEvent.click(screen.getByRole("tab", { name: "waiting" }));
    expect(screen.queryByText("Call the auditor")).not.toBeInTheDocument();
    expect(screen.getByText("Chase the DPA")).toBeInTheDocument();
  });

  it("quick-add posts a new next action", async () => {
    renderWithProviders(<Tasks />);
    await screen.findByText("Call the auditor");
    fireEvent.change(screen.getByPlaceholderText(/Add a next action/), { target: { value: "Book the review" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[0] === "/api/tasks" && c[1]?.method === "POST");
      expect(JSON.parse(String(post![1].body)).title).toBe("Book the review");
    });
  });

  it("quick-add carries an optional priority when chosen", async () => {
    renderWithProviders(<Tasks />);
    await screen.findByText("Call the auditor");
    fireEvent.change(screen.getByPlaceholderText(/Add a next action/), { target: { value: "Prep board pack" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[0] === "/api/tasks" && c[1]?.method === "POST");
      expect(JSON.parse(String(post![1].body)).priority).toBe("high");
    });
  });

  it("submits the quick-add on Enter in the title field", async () => {
    renderWithProviders(<Tasks />);
    await screen.findByText("Call the auditor");
    const input = screen.getByPlaceholderText(/Add a next action/);
    fireEvent.change(input, { target: { value: "Ring the bank" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[0] === "/api/tasks" && c[1]?.method === "POST");
      expect(JSON.parse(String(post![1].body)).title).toBe("Ring the bank");
    });
  });

  it("carries an @context and submits on Enter from the context field", async () => {
    renderWithProviders(<Tasks />);
    await screen.findByText("Call the auditor");
    fireEvent.change(screen.getByPlaceholderText(/Add a next action/), { target: { value: "Water the plants" } });
    const ctx = screen.getByPlaceholderText("@context");
    fireEvent.change(ctx, { target: { value: "@home" } });
    fireEvent.keyDown(ctx, { key: "Enter" });
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[0] === "/api/tasks" && c[1]?.method === "POST");
      const body = JSON.parse(String(post![1].body));
      expect(body.title).toBe("Water the plants");
      expect(body.context).toBe("@home");
    });
  });

  it("ignores an empty/whitespace quick-add — Enter with no real title posts nothing", async () => {
    renderWithProviders(<Tasks />);
    await screen.findByText("Call the auditor");
    const input = screen.getByPlaceholderText(/Add a next action/);
    fireEvent.keyDown(input, { key: "Enter" }); // empty
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" }); // whitespace-only
    // A non-Enter key is a no-op too (guards the keydown branch).
    fireEvent.keyDown(input, { key: "a" });
    expect(fetchMock.mock.calls.find((c) => c[0] === "/api/tasks" && c[1]?.method === "POST")).toBeUndefined();
  });

  it("opens the task detail dialog from a row and closes it again", async () => {
    renderWithProviders(<Tasks />);
    await screen.findByText("Call the auditor");
    // The list renders each task title as a button that opens the detail dialog (onOpen → setDetail).
    fireEvent.click(screen.getByRole("button", { name: "Call the auditor" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Call the auditor")).toBeInTheDocument();
    // Closing the dialog runs onOpenChange(false) → setDetail(null).
    fireEvent.click(within(dialog).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
