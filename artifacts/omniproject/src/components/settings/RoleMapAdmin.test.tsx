import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import type { Role } from "../../lib/auth";
import { parseGroups, type RoleMapState } from "../../lib/role-map";
import { RoleMapAdmin } from "./RoleMapAdmin";

/**
 * The admin group→role mapping editor composes the role-map read hook, the step-up-gated save +
 * rollback mutations, the RBAC gate, and the pure `parseGroups` splitter. Each seam is stubbed
 * behind a mutable module-level knob (the house pattern — see Whiteboards.test.tsx): `useRoleMap`
 * returns knob data, `withStepUp` runs (or blocks) the mutation per a knob, and the save/rollback
 * mutations resolve or reject per a knob. `roleAtLeast` + `parseGroups` are kept REAL so the
 * shipping gate + parsing logic are what's exercised. We assert the admin/loading gates, the
 * claim-mappable row rendering (guest hidden, source shown), local edits, and the save + rollback
 * handlers across the allowed / denied / error outcomes.
 */

// --- Per-test knobs (reset in beforeEach). ---
let role: Role = "admin";
let mapData: RoleMapState | undefined;
let stepAllowed = true;
let saveMode: "ok" | "err" = "ok";
let rollbackMode: "ok" | "err" = "ok";

const toast = vi.fn();
const saveRoleMap = vi.fn(async (_g: Record<string, string[]>): Promise<RoleMapState> => {
  if (saveMode === "err") throw new Error("save boom");
  return state();
});
const rollbackRoleMap = vi.fn(async (): Promise<RoleMapState> => {
  if (rollbackMode === "err") throw new Error("rollback boom");
  return state();
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("../../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role } }) };
});

vi.mock("../../lib/role-map", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/role-map")>();
  return {
    ...actual,
    useRoleMap: () => ({ data: mapData }),
    saveRoleMap: (g: Record<string, string[]>) => saveRoleMap(g),
    rollbackRoleMap: () => rollbackRoleMap(),
  };
});

// Mirror the real withStepUp contract: block when the step-up is declined, else run fn and
// swallow a rejection to null (the real helper surfaces its own toast on throw).
vi.mock("../../lib/step-up", () => ({
  withStepUp: async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (!stepAllowed) return null;
    try { return await fn(); } catch { return null; }
  },
}));

function state(): RoleMapState {
  return {
    roles: ["guest", "viewer", "manager", "admin"],
    mapping: [
      { role: "guest", claims: [], source: "env" },
      { role: "viewer", claims: ["staff"], source: "env" },
      { role: "manager", claims: ["omni-managers"], source: "override" },
      { role: "admin", claims: ["omni-admins"], source: "env" },
    ],
    rollbackAvailable: true,
  };
}

beforeEach(() => {
  role = "admin";
  mapData = state();
  stepAllowed = true;
  saveMode = rollbackMode = "ok";
  toast.mockClear();
  saveRoleMap.mockClear();
  rollbackRoleMap.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("RoleMapAdmin — gates", () => {
  it("renders nothing for a non-admin", () => {
    role = "manager";
    const { container } = renderWithProviders(<RoleMapAdmin />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the mapping is still loading (no data)", () => {
    mapData = undefined;
    const { container } = renderWithProviders(<RoleMapAdmin />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RoleMapAdmin — rendering", () => {
  it("renders the claim-mappable roles with their groups + source and hides guest", () => {
    renderWithProviders(<RoleMapAdmin />);
    expect(screen.getByTestId("role-map-row-manager")).toHaveTextContent("override");
    expect((screen.getByTestId("role-map-input-manager") as HTMLTextAreaElement).value).toBe("omni-managers");
    expect(screen.getByTestId("role-map-row-admin")).toBeInTheDocument();
    expect(screen.queryByTestId("role-map-row-guest")).not.toBeInTheDocument();
  });

  it("keeps edits local until saved and shows the undo when a rollback is available", () => {
    renderWithProviders(<RoleMapAdmin />);
    expect(screen.getByTestId("role-map-rollback")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("role-map-input-viewer"), { target: { value: "staff, contractors" } });
    expect((screen.getByTestId("role-map-input-viewer") as HTMLTextAreaElement).value).toBe("staff, contractors");
  });

  it("hides the undo button when no rollback is available", () => {
    mapData = { ...state(), rollbackAvailable: false };
    renderWithProviders(<RoleMapAdmin />);
    expect(screen.queryByTestId("role-map-rollback")).toBeNull();
  });
});

describe("RoleMapAdmin — save", () => {
  it("saves the parsed group lists, clears edits, invalidates and toasts on success", async () => {
    const client = renderWithProviders(<RoleMapAdmin />).queryClient;
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(screen.getByTestId("role-map-input-viewer"), { target: { value: "Staff, Contractors" } });
    fireEvent.click(screen.getByTestId("role-map-save"));
    await waitFor(() => expect(saveRoleMap).toHaveBeenCalled());
    const arg = saveRoleMap.mock.calls.at(-1)![0];
    // guest excluded; the edited row parsed (lower-cased); untouched rows use their existing claims.
    expect(arg).toEqual({ viewer: ["staff", "contractors"], manager: ["omni-managers"], admin: ["omni-admins"] });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "ROLE MAP SAVED" })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "role-map"] });
    // edit reset to the (unchanged) seed value
    expect((screen.getByTestId("role-map-input-viewer") as HTMLTextAreaElement).value).toBe("staff");
  });

  it("does not save or toast when the step-up is declined", async () => {
    stepAllowed = false;
    renderWithProviders(<RoleMapAdmin />);
    fireEvent.click(screen.getByTestId("role-map-save"));
    // save button returns to its resting label once the declined step-up resolves
    await waitFor(() => expect(screen.getByTestId("role-map-save")).toHaveTextContent("Save mapping"));
    expect(saveRoleMap).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not toast success when the save mutation rejects", async () => {
    saveMode = "err";
    renderWithProviders(<RoleMapAdmin />);
    fireEvent.click(screen.getByTestId("role-map-save"));
    await waitFor(() => expect(saveRoleMap).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "ROLE MAP SAVED" }));
  });

  it("shows a Saving… affordance while the save is in flight", async () => {
    let release!: () => void;
    saveRoleMap.mockImplementationOnce(() => new Promise<RoleMapState>((res) => { release = () => res(state()); }));
    renderWithProviders(<RoleMapAdmin />);
    fireEvent.click(screen.getByTestId("role-map-save"));
    await waitFor(() => expect(screen.getByTestId("role-map-save")).toHaveTextContent("Saving…"));
    expect(screen.getByTestId("role-map-save")).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByTestId("role-map-save")).toHaveTextContent("Save mapping"));
  });
});

describe("RoleMapAdmin — rollback", () => {
  it("rolls back, invalidates and toasts on success", async () => {
    const client = renderWithProviders(<RoleMapAdmin />).queryClient;
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByTestId("role-map-rollback"));
    await waitFor(() => expect(rollbackRoleMap).toHaveBeenCalled());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "ROLLED BACK" })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "role-map"] });
  });

  it("does not roll back or toast when the rollback step-up is declined", async () => {
    stepAllowed = false;
    renderWithProviders(<RoleMapAdmin />);
    fireEvent.click(screen.getByTestId("role-map-rollback"));
    // let the (declined) async handler settle, then assert nothing happened
    await Promise.resolve();
    await Promise.resolve();
    expect(rollbackRoleMap).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not toast success when the rollback mutation rejects", async () => {
    rollbackMode = "err";
    renderWithProviders(<RoleMapAdmin />);
    fireEvent.click(screen.getByTestId("role-map-rollback"));
    await waitFor(() => expect(rollbackRoleMap).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "ROLLED BACK" }));
  });
});

describe("parseGroups (real helper)", () => {
  it("splits, trims, lower-cases and de-dupes", () => {
    expect(parseGroups("A, b\n  A  c")).toEqual(["a", "b", "c"]);
  });
});
