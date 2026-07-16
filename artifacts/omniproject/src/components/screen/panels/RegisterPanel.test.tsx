import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../../test/utils";
import { settingsQueryKey } from "../../../lib/settings-query";
import type { Panel } from "../../../lib/screen";
import { RegisterPanel } from "./RegisterPanel";

const panel: Panel = {
  id: "raci", kind: "register", title: "RACI",
  config: {
    collection: "raci", endpoint: "/api/raci", idPrefix: "raci", addLabel: "Add RACI entry",
    columns: [
      { field: "task", label: "Task", type: "text" },
      { field: "role", label: "Role", type: "text" },
      { field: "responsibility", label: "R/A/C/I", type: "select", options: ["R", "A", "C", "I"] },
    ],
  },
};

function seed(role: string, raci: unknown[], collectionEditRoles: Record<string, string> = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(settingsQueryKey, { raci, collectionEditRoles });
  return qc;
}
afterEach(() => vi.restoreAllMocks());

describe("RegisterPanel (editable data on the screen)", () => {
  it("is user-editable by default: a contributor can edit", () => {
    renderWithProviders(<RegisterPanel panel={panel} />, { client: seed("contributor", []) });
    expect(screen.getByTestId("register-add")).toBeTruthy();
  });

  it("viewers see the register read-only (no add/save)", () => {
    renderWithProviders(<RegisterPanel panel={panel} />, { client: seed("viewer", [{ id: "r1", task: "Deploy", role: "Ops", responsibility: "A" }]) });
    expect(screen.getByTestId("register-readonly-body").textContent).toContain("Deploy");
    expect(screen.queryByTestId("register-add")).toBeNull();
    expect(screen.queryByTestId("register-save")).toBeNull();
  });

  it("respects a raised policy: with raci→pmo, a manager is read-only", () => {
    renderWithProviders(<RegisterPanel panel={panel} />, { client: seed("manager", [], { raci: "pmo" }) });
    expect(screen.queryByTestId("register-add")).toBeNull();
  });

  it("respects a read-only policy: even an admin can't edit", () => {
    renderWithProviders(<RegisterPanel panel={panel} />, { client: seed("admin", [], { raci: "readonly" }) });
    expect(screen.queryByTestId("register-add")).toBeNull();
    expect(screen.getByTestId("register-readonly-body")).toBeTruthy();
  });

  it("a manager can add + edit a row and Save PUTs it to the collection endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<RegisterPanel panel={panel} />, { client: seed("manager", []) });
    fireEvent.click(screen.getByTestId("register-add"));
    fireEvent.change(screen.getByLabelText("Row 1 Task"), { target: { value: "Deploy" } });
    fireEvent.change(screen.getByLabelText("Row 1 Role"), { target: { value: "Ops" } });
    fireEvent.change(screen.getByLabelText("Row 1 R/A/C/I"), { target: { value: "A" } });
    fireEvent.click(screen.getByTestId("register-save"));
    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => u === "/api/raci" && (i as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { raci: Array<{ task: string; role: string; responsibility: string }> };
    expect(body.raci[0]).toMatchObject({ task: "Deploy", role: "Ops", responsibility: "A" });
  });
});
