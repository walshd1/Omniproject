import { describe, it, expect } from "vitest";
import { pickActiveDef, type ResolvedBinding, type StoredDef } from "./defs";

/**
 * pickActiveDef (roadmap X.12 slice 3) — the pure client helper that maps a slot's server-resolved winner
 * (defId) to the actual def object from the resolved list, or null (→ system default). The winner LOGIC lives
 * server-side (def-binding); this only looks up the chosen id.
 */
const def = (id: string): StoredDef & { payload: unknown } => ({
  id, kind: "screen", name: id, storage: id.split("~")[0]!, createdBy: null,
  createdAt: "", updatedAt: "", rowVersion: 1, payload: { id },
});
const resolved = [def("org~a"), def("user~b"), def("system~c")];

describe("pickActiveDef", () => {
  it("returns the def whose id the binding selected", () => {
    const active: Record<string, ResolvedBinding> = { screens: { defId: "user~b", locked: false, source: "user" } };
    expect(pickActiveDef(resolved, active, "screens")?.id).toBe("user~b");
  });

  it("returns null when there's no binding for the slot (→ system default)", () => {
    expect(pickActiveDef(resolved, {}, "screens")).toBeNull();
    const active: Record<string, ResolvedBinding> = { screens: { defId: null, locked: false, source: "default" } };
    expect(pickActiveDef(resolved, active, "screens")).toBeNull();
  });

  it("returns null when the selected id isn't in the visible resolved list (fail-safe → default)", () => {
    const active: Record<string, ResolvedBinding> = { screens: { defId: "project~gone", locked: false, source: "project" } };
    expect(pickActiveDef(resolved, active, "screens")).toBeNull();
  });

  it("tolerates a non-array resolved payload (fetch-mock / loading) without throwing", () => {
    const active: Record<string, ResolvedBinding> = { screens: { defId: "user~b", locked: false, source: "user" } };
    expect(pickActiveDef(undefined, active, "screens")).toBeNull();
    expect(pickActiveDef({} as unknown as StoredDef[] & { payload: unknown }[], active, "screens")).toBeNull();
  });
});
