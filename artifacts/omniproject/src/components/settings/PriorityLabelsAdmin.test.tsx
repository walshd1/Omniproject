import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { PriorityLabelsAdmin } from "./PriorityLabelsAdmin";

let role = "admin";
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ data: { role } }),
  isPmoOrAdmin: (r?: string) => r === "admin" || r === "pmo",
}));

const STATE = { canonical: ["none", "low", "medium", "high", "urgent"], labels: {} as Record<string, string> };
function json(body: unknown, ok = true): Response { return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as Response; }
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/priority-labels" && init?.method === "PUT") return Promise.resolve(json({ canonical: STATE.canonical, labels: JSON.parse(String(init.body)).labels }));
    if (url === "/api/priority-labels") return Promise.resolve(json(STATE));
    return Promise.resolve(json({}, false));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("PriorityLabelsAdmin", () => {
  it("is hidden for a non-admin/PMO", () => {
    role = "contributor";
    renderWithProviders(<PriorityLabelsAdmin />);
    expect(screen.queryByText("Priority level labels")).not.toBeInTheDocument();
  });

  it("PMO can rename a level; 'none' is not editable", async () => {
    role = "pmo";
    renderWithProviders(<PriorityLabelsAdmin />);
    expect(await screen.findByText("Priority level labels")).toBeInTheDocument();
    expect(screen.queryByLabelText("none")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("urgent"), { target: { value: "P0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(JSON.parse(String(put![1].body)).labels.urgent).toBe("P0");
    });
  });
});
