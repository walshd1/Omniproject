import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { NextActions } from "./NextActions";

const SUMMARY = { total: 3, byClass: { actionable: 1, waiting: 1, deferred: 0, done: 1, dropped: 0 }, open: 2, actionable: 1, overdue: 1, dueSoon: 0, unassigned: 1, byAssignee: {}, byTag: {}, byContext: {} };
let tasks = [
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

describe("NextActions", () => {
  it("shows the summary strip and the task list", async () => {
    renderWithProviders(<NextActions />);
    expect(await screen.findByText("Call the auditor")).toBeInTheDocument();
    expect(screen.getByText("Chase the DPA")).toBeInTheDocument();
    expect(screen.getByText("Actionable")).toBeInTheDocument();
  });

  it("filtering by status narrows the list", async () => {
    renderWithProviders(<NextActions />);
    await screen.findByText("Call the auditor");
    fireEvent.click(screen.getByRole("tab", { name: "waiting" }));
    expect(screen.queryByText("Call the auditor")).not.toBeInTheDocument();
    expect(screen.getByText("Chase the DPA")).toBeInTheDocument();
  });

  it("quick-add posts a new next action", async () => {
    renderWithProviders(<NextActions />);
    await screen.findByText("Call the auditor");
    fireEvent.change(screen.getByPlaceholderText("Add a next action…"), { target: { value: "Book the review" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[0] === "/api/tasks" && c[1]?.method === "POST");
      expect(JSON.parse(String(post![1].body)).title).toBe("Book the review");
    });
  });
});
