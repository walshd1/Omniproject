import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { settingsQueryKey } from "../../lib/settings-query";
import { ScreensAdmin } from "./ScreensAdmin";

// House style: mock the toast hook so error/success paths (which only surface a toast) are assertable.
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

type SeedOpts = {
  legacy?: Array<{ id: string; label?: string }>;
  layouts?: Record<string, unknown>;
  /** Override the scoped def-store rows independently of the resolved override set (for legacy-only cases). */
  scopedDefs?: Array<{ id: string; label?: string }> | null;
};

function seed(role: string | undefined, org: Array<{ id: string; label?: string }> = [], disabled: string[] = [], opts: SeedOpts = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  // disabledScreens + collectionEditRoles + screenLayouts are slices of the shared /api/settings read.
  qc.setQueryData(settingsQueryKey, { disabledScreens: disabled, screenLayouts: opts.layouts ?? {} });
  // Screen OVERRIDES are def-store artifacts now: the resolved override set (useOrgScreenDefs), the legacy
  // bridge (useLegacyOrgScreenDefs), and the org `screen` defs with their scoped ids (useResolvedDefs).
  qc.setQueryData(["screen-defs", "resolved"], org);
  qc.setQueryData(["screen-defs", "legacy"], opts.legacy ?? []);
  const scoped = opts.scopedDefs === undefined ? org : opts.scopedDefs;
  qc.setQueryData(["defs", "resolved", "screen", null, null], (scoped ?? []).map((s, i) => ({
    id: `org~s${i}`, kind: "screen", name: s.label ?? s.id, payload: s, createdBy: null, createdAt: "", updatedAt: "", rowVersion: 1,
  })));
  return qc;
}

beforeEach(() => toastMock.mockClear());
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

  it("toasts a failure when turning a screen off does not save", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("screen-toggle-kanban"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT SAVE", variant: "destructive" })));
  });

  it("toasts a failure when saving edit access fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByTestId("screen-edit-access-raci-matrix"), { target: { value: "pmo" } });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT SAVE", variant: "destructive" })));
  });

  it("resets edit access back to the default (removes the collection override)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const qc = seed("admin");
    qc.setQueryData(settingsQueryKey, { disabledScreens: [], collectionEditRoles: { raci: "manager" } });
    renderWithProviders(<ScreensAdmin />, { client: qc });
    fireEvent.change(screen.getByTestId("screen-edit-access-raci-matrix"), { target: { value: "default" } });
    const put = await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => u === "/api/collection-edit-roles" && (i as RequestInit)?.method === "PUT");
      expect(c).toBeTruthy();
      return c!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { collectionEditRoles: Record<string, string> };
    expect(body.collectionEditRoles.raci).toBeUndefined(); // "default" deletes the entry
  });

  it("keeps the editor open and toasts when an override save fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo") });
    fireEvent.click(screen.getByTestId("screen-edit-kanban"));
    fireEvent.change(screen.getByTestId("screen-editor-label"), { target: { value: "Nope" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT SAVE", variant: "destructive" })));
    expect(screen.getByTestId("screen-editor")).toBeInTheDocument(); // not closed on failure
  });

  it("updates an existing override in place via PUT (already has a scoped def)", async () => {
    const org = [{ id: "kanban", label: "Old", panels: [] as unknown[] }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo", org) });
    fireEvent.click(screen.getByTestId("screen-edit-kanban"));
    fireEvent.change(screen.getByTestId("screen-editor-label"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/defs/org~s0" && (i as RequestInit)?.method === "PUT");
      expect(c).toBeTruthy();
    });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "SCREEN OVERRIDDEN" })));
  });

  it("closes the editor when the editor's Cancel is used", () => {
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo") });
    fireEvent.click(screen.getByTestId("screen-edit-kanban"));
    expect(screen.getByTestId("screen-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("screen-editor")).toBeNull();
  });

  it("resets an override back to the shipped default (DELETEs the scoped def)", async () => {
    const org = [{ id: "kanban", label: "Custom", panels: [] as unknown[] }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("admin", org) });
    fireEvent.click(screen.getByTestId("screen-reset-kanban"));
    await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/defs/org~s0" && (i as RequestInit)?.method === "DELETE");
      expect(c).toBeTruthy();
    });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "RESET TO DEFAULT" })));
  });

  it("prompts to migrate first when resetting a legacy-only override (no scoped def)", () => {
    const org = [{ id: "kanban", label: "Legacy", panels: [] as unknown[] }];
    renderWithProviders(<ScreensAdmin />, { client: seed("admin", org, [], { scopedDefs: [] }) });
    fireEvent.click(screen.getByTestId("screen-reset-kanban"));
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "MIGRATE FIRST" }));
  });

  it("toasts a failure when a reset cannot be saved", async () => {
    const org = [{ id: "kanban", label: "Custom", panels: [] as unknown[] }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("admin", org) });
    fireEvent.click(screen.getByTestId("screen-reset-kanban"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT RESET", variant: "destructive" })));
  });

  it("migrates legacy screen overrides into the def store", async () => {
    const legacy = [{ id: "legacy-screen", label: "Legacy Screen" }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo", [], [], { legacy }) });
    fireEvent.click(screen.getByTestId("screens-migrate-legacy"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/defs" && (i as RequestInit)?.method === "POST")).toBe(true);
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/screen-defs" && (i as RequestInit)?.method === "PUT")).toBe(true);
    });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "MIGRATED" })));
  });

  it("toasts when a legacy migration fails", async () => {
    const legacy = [{ id: "legacy-screen", label: "Legacy Screen" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo", [], [], { legacy }) });
    fireEvent.click(screen.getByTestId("screens-migrate-legacy"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "MIGRATION FAILED", variant: "destructive" })));
  });

  it("folds legacy screen layouts into the def store (updating an existing scoped def, skipping unknown screens)", async () => {
    // kanban is a real catalogue screen with a scoped def → update path; "ghost" isn't → skipped.
    const org = [{ id: "kanban", label: "K", panels: [] as unknown[] }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo", org, [], { layouts: { kanban: { cols: 2 }, ghost: { cols: 1 } } }) });
    fireEvent.click(screen.getByTestId("screens-migrate-layouts"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/defs/org~s0" && (i as RequestInit)?.method === "PUT")).toBe(true);
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/screen-layouts" && (i as RequestInit)?.method === "PUT")).toBe(true);
    });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "MIGRATED" })));
  });

  it("folds a legacy layout for a not-yet-overridden screen via a new def (import path)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo", [], [], { layouts: { kanban: { cols: 2 } } }) });
    fireEvent.click(screen.getByTestId("screens-migrate-layouts"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === "/api/defs" && (i as RequestInit)?.method === "POST")).toBe(true);
    });
  });

  it("falls back to a generic message when a non-Error is thrown (toggle off)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("boom"); // a non-Error rejection
    renderWithProviders(<ScreensAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("screen-toggle-kanban"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT SAVE", description: "Try again." })));
  });

  it("falls back to a generic message when an override save throws a non-Error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("boom");
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo") });
    fireEvent.click(screen.getByTestId("screen-edit-kanban"));
    fireEvent.change(screen.getByTestId("screen-editor-label"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT SAVE", description: "Try again." })));
  });

  it("falls back to a generic message when a reset throws a non-Error", async () => {
    const org = [{ id: "kanban", label: "Custom", panels: [] as unknown[] }];
    vi.spyOn(globalThis, "fetch").mockRejectedValue("boom");
    renderWithProviders(<ScreensAdmin />, { client: seed("admin", org) });
    fireEvent.click(screen.getByTestId("screen-reset-kanban"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT RESET", description: "Try again." })));
  });

  it("renders from the built-in catalogue when no org data is seeded (nullish fallbacks)", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    qc.setQueryData(["auth", "me"], { authenticated: true, role: "admin", user: { sub: "u1" } });
    // No screen-defs / settings / defs seeded → orgDefs, disabled, editRoles, defs all resolve via ?? fallbacks.
    renderWithProviders(<ScreensAdmin />, { client: qc });
    expect(screen.getByTestId("screens-admin")).toBeInTheDocument();
    expect(screen.getByTestId("screen-row-home")).toBeInTheDocument();
    // Nothing is overridden with an empty def store.
    expect(screen.queryByTestId("screen-overridden-kanban")).toBeNull();
  });

  it("shows 'Off' for a disabled screen", () => {
    renderWithProviders(<ScreensAdmin />, { client: seed("admin", [], ["kanban"]) });
    expect(screen.getByTestId("screen-row-kanban").textContent).toContain("Off");
  });

  it("pluralises the legacy-migration button label for multiple overrides", () => {
    const legacy = [{ id: "a" }, { id: "b" }];
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo", [], [], { legacy }) });
    expect(screen.getByTestId("screens-migrate-legacy").textContent).toContain("overrides");
  });

  it("toggles the Customise button open and closed", () => {
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo") });
    const btn = screen.getByTestId("screen-edit-kanban");
    fireEvent.click(btn); // open → label becomes "Close"
    expect(btn.textContent).toBe("Close");
    fireEvent.click(btn); // close via the same button (editing ? null branch)
    expect(screen.queryByTestId("screen-editor")).toBeNull();
  });

  it("toasts when folding legacy layouts fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    renderWithProviders(<ScreensAdmin />, { client: seed("pmo", [], [], { layouts: { kanban: { cols: 2 } } }) });
    fireEvent.click(screen.getByTestId("screens-migrate-layouts"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "MIGRATION FAILED", variant: "destructive" })));
  });
});
