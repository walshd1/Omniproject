import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetCapabilitiesQueryKey,
  getListTaskItemsQueryKey,
  type Capabilities,
  type TaskItem,
} from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../test/utils";
import { useToast } from "@/hooks/use-toast";
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

  it("shows the plain kind label (no dropdown) when only one kind is storable, falls back to the raw kind for an unlabeled one, and renders the author line", () => {
    const items = [
      { id: "w1", taskId: "t1", kind: "weird", content: "Odd kind", author: "Bob", createdAt: "" },
    ] as unknown as TaskItem[];
    renderWithProviders(<TaskItemsPanel projectId="p1" taskId="t1" />, {
      client: client({ issue: { surface: true, store: true }, note: { surface: false, store: false } }, items),
    });
    // Single storable kind ⇒ plain label, not a <Select> dropdown.
    expect(screen.getByText("Issue")).toBeInTheDocument();
    expect(screen.queryByLabelText("Kind")).toBeNull();
    // Unknown kind falls back to the raw string.
    expect(screen.getByText("weird")).toBeInTheDocument();
    expect(screen.getByText(/— Bob/)).toBeInTheDocument();
  });

  describe("adding an item", () => {
    afterEach(resetFetchMock);

    it("does nothing on submit when the content is only whitespace", () => {
      const calls = mockFetchRouter({});
      const { container } = renderWithProviders(<TaskItemsPanel projectId="p1" taskId="t1" />, {
        client: client({ issue: { surface: true, store: true }, note: { surface: false, store: false } }),
      });
      fireEvent.change(screen.getByLabelText("New item content"), { target: { value: "   " } });
      fireEvent.submit(container.querySelector("form")!);
      expect(calls.some((c) => c.url.includes("/items"))).toBe(false);
    });

    it("submits a new item, shows a success toast, clears the input and refetches the list", async () => {
      const user = userEvent.setup();
      const calls = mockFetchRouter({
        "POST /api/projects/p1/issues/t1/items": { ok: true, body: { id: "new1", taskId: "t1", kind: "issue", content: "Found a defect", createdAt: "" } },
        "GET /api/projects/p1/issues/t1/items": { ok: true, body: [] },
      });
      const { result: toastResult } = renderHook(() => useToast());
      renderWithProviders(<TaskItemsPanel projectId="p1" taskId="t1" />, {
        client: client({ issue: { surface: true, store: true }, note: { surface: false, store: false } }),
      });

      const input = screen.getByLabelText("New item content");
      await user.type(input, "Found a defect");
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      await waitFor(() => expect(toastResult.current.toasts.some((t) => t.title === "Issue added")).toBe(true));
      expect(input).toHaveValue("");
      const postCall = calls.find((c) => c.url.includes("/items") && c.init?.method === "POST");
      expect(JSON.parse(String(postCall!.init!.body))).toEqual({ kind: "issue", content: "Found a defect" });
    });

    it("shows an error toast when the create mutation fails", async () => {
      const user = userEvent.setup();
      mockFetchRouter({
        "POST /api/projects/p1/issues/t1/items": { ok: false, status: 500, body: { message: "boom" } },
      });
      const { result: toastResult } = renderHook(() => useToast());
      renderWithProviders(<TaskItemsPanel projectId="p1" taskId="t1" />, {
        client: client({ issue: { surface: true, store: true }, note: { surface: false, store: false } }),
      });

      await user.type(screen.getByLabelText("New item content"), "Will fail");
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      await waitFor(() => expect(toastResult.current.toasts.some((t) => t.title === "ERROR")).toBe(true));
    });
  });
});
