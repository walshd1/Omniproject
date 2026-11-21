import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { WeeklyReviewScreen } from "./WeeklyReviewScreen";

/**
 * The guided GTD Weekly Review: five steps over the live task entity, inline re-files, and the
 * pack's own "every active project has a next action" invariant as the closing step.
 */

const TASKS = [
  { id: "t1", title: "Sort receipts", status: "inbox" },
  { id: "t2", title: "Call plumber", status: "next", context: "calls", projectId: "p2" },
  { id: "t3", title: "Contract from legal", status: "waiting", waitingOn: "Dana", projectId: "p1" },
  { id: "t4", title: "Learn woodworking", status: "someday" },
];
const PROJECTS = [
  { id: "p1", name: "House move", identifier: "HM", source: "demo" }, // only a waiting task → violation
  { id: "p2", name: "Kitchen", identifier: "K", source: "demo" }, // has a next action → clean
  { id: "p3", name: "Issue-only project", identifier: "IO", source: "demo" }, // no tasks at all → NOT evaluated
];

function mount() {
  mockFetchRouter({
    "GET /api/tasks": { ok: true, body: TASKS },
    "GET /api/projects": { ok: true, body: PROJECTS },
    "PATCH /api/tasks/t1": { ok: true, body: { ...TASKS[0], status: "next" } },
  });
  return renderWithProviders(<WeeklyReviewScreen />);
}

describe("WeeklyReviewScreen", () => {
  afterEach(resetFetchMock);

  it("walks the five steps with live counts and lists the inbox first", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("Sort receipts")).toBeInTheDocument());
    // Step chips carry the live counts: 1 inbox, 1 next, 1 waiting, 1 someday.
    expect(screen.getByRole("tab", { name: /1\. Inbox to zero \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /3\. Waiting for \(1\)/i })).toBeInTheDocument();
    // Inbox offers the full clarify set.
    expect(screen.getByRole("button", { name: "→ Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "→ Someday" })).toBeInTheDocument();
  });

  it("re-files a task inline (clarifying an inbox item PATCHes its status)", async () => {
    const calls = mockFetchRouter({
      "GET /api/tasks": { ok: true, body: TASKS },
      "GET /api/projects": { ok: true, body: PROJECTS },
      "PATCH /api/tasks/t1": { ok: true, body: { ...TASKS[0], status: "next" } },
    });
    renderWithProviders(<WeeklyReviewScreen />);
    await waitFor(() => expect(screen.getByText("Sort receipts")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "→ Next" }));
    const patchCall = () => calls.find((c) => (c.init?.method ?? "GET").toUpperCase() === "PATCH" && c.url.includes("/api/tasks/t1"));
    await waitFor(() => expect(patchCall()).toBeTruthy());
    expect(JSON.parse(String(patchCall()!.init?.body ?? "{}"))).toEqual({ status: "next" });
  });

  it("closes on the pack invariant: a task-carrying project without a next action is flagged; task-less projects are not", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("Sort receipts")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /5\. Projects/i }));
    await waitFor(() => expect(screen.getByTestId("violation-row")).toBeInTheDocument());
    // p1 (waiting only) is in breach; p2 (has a next action) and p3 (no tasks → not GTD-managed) are not.
    expect(screen.getByText("House move")).toBeInTheDocument();
    expect(screen.queryByText("Kitchen")).not.toBeInTheDocument();
    expect(screen.queryByText("Issue-only project")).not.toBeInTheDocument();
  });

  it("shows the all-clear when a step's list is empty", async () => {
    mockFetchRouter({
      "GET /api/tasks": { ok: true, body: [{ id: "t2", title: "Call plumber", status: "next" }] },
      "GET /api/projects": { ok: true, body: [] },
    });
    renderWithProviders(<WeeklyReviewScreen />);
    await waitFor(() => expect(screen.getByTestId("step-clear")).toBeInTheDocument());
  });
});
