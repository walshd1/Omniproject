import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../../test/utils";
import { settingsQueryKey } from "../../../lib/settings-query";
import { useStore } from "../../../store/useStore";
import { slotRowsQueryKey } from "../../../lib/data-slot";
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

// ── SLOT source: the SAME register panel over a generic mapping slot (no new primitive) ──────────────────────
const slotPanel: Panel = {
  id: "epics", kind: "register", title: "Epics",
  config: { slot: "epics", columns: [{ field: "id", label: "Id" }, { field: "name", label: "Name" }] },
};

function seedSlot(role: string, rows: unknown[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(settingsQueryKey, {});                               // collectionEditRoles read still fires
  qc.setQueryData(slotRowsQueryKey("proj-001", "epics"), { rows });    // useSlotRows reads {rows}
  useStore.setState({ activeProjectId: "proj-001" });
  return qc;
}

describe("RegisterPanel (slot source — the same editable grid over a mapping slot)", () => {
  it("renders the slot's rows and a contributor can edit", () => {
    renderWithProviders(<RegisterPanel panel={slotPanel} />, { client: seedSlot("contributor", [{ id: "E-1", name: "Checkout" }]) });
    expect(screen.getByTestId("register-add")).toBeTruthy();
    expect(screen.getByDisplayValue("Checkout")).toBeTruthy();
  });

  it("Save UPSERTs each row via PUT to the generic slot endpoint (id keys the row)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    renderWithProviders(<RegisterPanel panel={slotPanel} />, { client: seedSlot("contributor", [{ id: "E-1", name: "Checkout" }]) });
    fireEvent.change(screen.getByLabelText("Row 1 Name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("register-save"));
    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/projects/proj-001/mapping/epics/E-1" && (i as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { fields: { name: string } };
    expect(body.fields.name).toBe("Renamed");       // id keys the row, not a written field
  });

  it("Save DELETEs a row the draft dropped (reconcile)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    renderWithProviders(<RegisterPanel panel={slotPanel} />, { client: seedSlot("contributor", [{ id: "E-1", name: "Checkout" }]) });
    fireEvent.click(screen.getByLabelText("Remove row 1"));
    fireEvent.click(screen.getByTestId("register-save"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/projects/proj-001/mapping/epics/E-1" && (i as RequestInit)?.method === "DELETE");
      expect(call).toBeTruthy();
    });
  });
});
