import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { settingsQueryKey } from "../../lib/settings-query";
import { ScreensAdmin } from "./ScreensAdmin";

function seed(role: string | undefined, org: Array<{ id: string; label?: string }> = [], disabled: string[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  // disabledScreens + collectionEditRoles are still slices of the shared /api/settings read.
  qc.setQueryData(settingsQueryKey, { disabledScreens: disabled });
  // Screen OVERRIDES are def-store artifacts now: the resolved override set (useOrgScreenDefs), the legacy
  // bridge (useLegacyOrgScreenDefs), and the org `screen` defs with their scoped ids (useResolvedDefs).
  qc.setQueryData(["screen-defs", "resolved"], org);
  qc.setQueryData(["screen-defs", "legacy"], []);
  qc.setQueryData(["defs", "resolved", "screen", null, null], org.map((s, i) => ({
    id: `org~s${i}`, kind: "screen", name: s.label ?? s.id, payload: s, createdBy: null, createdAt: "", updatedAt: "", rowVersion: 1,
  })));
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("ScreensAdmin", () => {
  it("renders nothing below admin/PMO", () => {
    renderWithProviders(<ScreensAdmin />, { client: seed("manager") });
    expect(screen.queryByTestId("screens-admin")).not.toBeInTheDocument();
  });

  it("lists screens and marks org-overridden ones", () => {
    const org = [{ id: "kanban", label: "Team Board", panels: [{ id: "b", kind: "view" }] }];
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo", org) });
    expect(screen.getByTestId("screens-admin")).toBeInTheDocument();
    expect(screen.getByTestId("screen-row-budget-plans")).toBeInTheDocument();
    expect(screen.getByTestId("screen-overridden-kanban")).toBeInTheDocument(); // badge
  });

  it("turning a screen off PUTs the disabled list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("screen-toggle-kanban")); // was On → turn Off
    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => u === "/api/disabled-screens" && (i as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { disabledScreens: string[] };
    expect(body.disabledScreens).toContain("kanban");
  });

  it("customising via the structured editor POSTs the override as a def (id pinned)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo") }); // kanban not yet overridden → a new def
    fireEvent.click(screen.getByTestId("screen-edit-kanban"));
    expect(screen.getByTestId("screen-editor")).toBeInTheDocument(); // structured editor, not a raw textarea
    fireEvent.change(screen.getByTestId("screen-editor-label"), { target: { value: "Custom Kanban" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    const post = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/defs" && (i as RequestInit)?.method === "POST");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((post[1] as RequestInit).body as string) as { kind: string; storage: string; payload: { id: string; label: string } };
    expect(body.kind).toBe("screen");
    expect(body.storage).toBe("org");
    expect(body.payload.label).toBe("Custom Kanban");
    expect(body.payload.id).toBe("kanban"); // pinned — the editor can't retarget the override
  });

  it("panel-kind picker is driven by the shared primitive store (incl. previously-missing kinds)", () => {
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo") });
    fireEvent.click(screen.getByTestId("screen-edit-kanban"));
    const kindSelect = screen.getByTestId("panel-kind-0");
    const options = Array.from(kindSelect.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    // These come from the store, not the old hand-maintained PANEL_KINDS list which omitted them.
    expect(options).toContain("register");
    expect(options).toContain("form");
    // Grouped into subfolders (optgroups).
    expect(kindSelect.querySelectorAll("optgroup").length).toBeGreaterThan(1);
  });

  it("sets per-screen edit access for a register-bearing screen (PUTs collection-edit-roles)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("admin") });
    // raci-matrix hosts a register on collection "raci" → its edit-access dropdown is shown.
    fireEvent.change(screen.getByTestId("screen-edit-access-raci-matrix"), { target: { value: "manager" } });
    const put = await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => u === "/api/collection-edit-roles" && (i as RequestInit)?.method === "PUT");
      expect(c).toBeTruthy();
      return c!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { collectionEditRoles: Record<string, string> };
    expect(body.collectionEditRoles.raci).toBe("manager");
  });

  it("a core screen shows the Core badge and no on/off toggle", () => {
    renderWithProviders(<ScreensAdmin />, { client: seed("admin") });
    expect(screen.getByTestId("screen-core-home")).toBeInTheDocument();
    expect(screen.queryByTestId("screen-toggle-home")).toBeNull(); // can't be turned off
    expect(screen.getByTestId("screen-edit-home")).toBeInTheDocument(); // …but can be customised
  });
});
