import { describe, it, expect, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetTasksQueryKey, type Task } from "@workspace/api-client-react";
import { renderWithProviders, resetFetchMock } from "../../test/utils";
import { PlanMyDay } from "./PlanMyDay";

// A fixed "now" so the "today" window is deterministic (the engine never calls Date).
const NOW = Date.parse("2026-07-27T12:00:00Z");

function task(over: Partial<Task> = {}): Task {
  return { id: "t", title: "T", status: "next", ...over } as Task;
}

function seed(tasks: Task[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetTasksQueryKey({ projectId: "p1" }), tasks);
  return qc;
}

afterEach(() => resetFetchMock());

describe("PlanMyDay", () => {
  it("ranks overdue and due-today tasks into today's plan", () => {
    renderWithProviders(<PlanMyDay projectId="p1" now={NOW} />, {
      client: seed([
        task({ id: "late", dueDate: "2026-07-25T00:00:00Z" }),
        task({ id: "today", dueDate: "2026-07-27T09:00:00Z" }),
        task({ id: "later", dueDate: "2026-08-15T00:00:00Z" }),
      ]),
    });
    expect(screen.getByTestId("plan-my-day")).toBeInTheDocument();
    // overdue + due-today are picked; the far-future task is not.
    expect(screen.getByTestId("plan-row-late")).toBeInTheDocument();
    expect(screen.getByTestId("plan-row-today")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-row-later")).toBeNull();
  });

  it("shows the empty state when nothing is due or flagged", () => {
    renderWithProviders(<PlanMyDay projectId="p1" now={NOW} />, {
      client: seed([task({ id: "later", dueDate: "2026-08-15T00:00:00Z" })]),
    });
    expect(screen.getByTestId("plan-my-day-empty")).toBeInTheDocument();
  });
});
