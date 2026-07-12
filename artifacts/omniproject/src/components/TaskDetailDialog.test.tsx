import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { TaskDetailDialog } from "./TaskDetailDialog";
import type { Task } from "../lib/tasks";

const TASK: Task = { id: "task-1", title: "Review the SOW", status: "next", context: "@computer", description: "Check clause 7." };
let comments = [{ id: "c1", taskId: "task-1", body: "Flagged clause 7.", author: "pat@demo", createdAt: "2026-07-12T10:00:00Z" }];

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  comments = [{ id: "c1", taskId: "task-1", body: "Flagged clause 7.", author: "pat@demo", createdAt: "2026-07-12T10:00:00Z" }];
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/comments") && init?.method === "POST") { const b = JSON.parse(String(init.body)); comments = [...comments, { id: "c2", taskId: "task-1", body: b.body, author: "me", createdAt: "2026-07-12T11:00:00Z" }]; return Promise.resolve(json(comments[comments.length - 1])); }
    if (url.endsWith("/comments")) return Promise.resolve(json(comments));
    if (url.endsWith("/attachments")) return Promise.resolve(json([]));
    return Promise.resolve(json({}, false));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("TaskDetailDialog", () => {
  it("shows the task's fields and comments thread", async () => {
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Flagged clause 7.")).toBeInTheDocument();
    expect(screen.getByText("Check clause 7.")).toBeInTheDocument();
    expect(screen.getByText("@computer")).toBeInTheDocument();
  });

  it("posting a comment hits the comments endpoint", async () => {
    renderWithProviders(<TaskDetailDialog task={TASK} open onOpenChange={() => {}} />);
    await screen.findByText("Flagged clause 7.");
    fireEvent.change(screen.getByPlaceholderText("Add a comment…"), { target: { value: "Legal signed off" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/tasks/task-1/comments") && c[1]?.method === "POST");
      expect(JSON.parse(String(post![1].body)).body).toBe("Legal signed off");
    });
  });
});
