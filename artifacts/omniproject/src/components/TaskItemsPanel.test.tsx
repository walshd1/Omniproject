import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetCapabilitiesQueryKey,
  getListTaskItemsQueryKey,
  type Capabilities,
  type TaskItem,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { TaskItemsPanel } from "./TaskItemsPanel";

function client(entities: Record<string, { surface: boolean; store: boolean }>, items: TaskItem[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetCapabilitiesQueryKey(), { mode: "demo", entities } as unknown as Capabilities);
  qc.setQueryData(getListTaskItemsQueryKey("p1", "t1"), items);
  return qc;
}

describe("TaskItemsPanel", () => {
  it("renders nothing when the backend can't surface issues or notes", () => {
    const { container } = renderWithProviders(<TaskItemsPanel projectId="p1" taskId="t1" />, {
      client: client({ issue: { surface: false, store: false }, note: { surface: false, store: false } }),
    });
    expect(container.querySelector('[data-testid="task-items"]')).toBeNull();
  });

  it("lists child items and offers the kinds the backend can store", () => {
    const items = [
      { id: "i1", taskId: "t1", kind: "issue", content: "Found a defect", createdAt: "" },
      { id: "n1", taskId: "t1", kind: "note", content: "Called the vendor", createdAt: "" },
    ] as unknown as TaskItem[];
    renderWithProviders(<TaskItemsPanel projectId="p1" taskId="t1" />, {
      client: client({ issue: { surface: true, store: true }, note: { surface: true, store: true } }, items),
    });
    expect(screen.getByTestId("task-items")).toBeInTheDocument();
    expect(screen.getByText("Found a defect")).toBeInTheDocument();
    expect(screen.getByText("Called the vendor")).toBeInTheDocument();
    expect(screen.getByLabelText("New item content")).toBeInTheDocument();
  });

  it("shows a read-only message when items surface but can't be stored", () => {
    renderWithProviders(<TaskItemsPanel projectId="p1" taskId="t1" />, {
      client: client({ issue: { surface: true, store: false }, note: { surface: false, store: false } }),
    });
    expect(screen.getByText(/can't store new ones/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("New item content")).toBeNull();
  });
});
