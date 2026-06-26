import { describe, it, expect } from "vitest";
import type { Capabilities } from "@workspace/api-client-react";
import { canSurfaceField, canStoreField, canSurfaceEntity, canStoreEntity } from "./capabilities-fields";

const caps = {
  mode: "demo",
  fields: {
    dueDate: { surface: true, store: true },
    completionPct: { surface: true, store: false }, // read-only
    storyPoints: { surface: false, store: false }, // unsupported
  },
  entities: {
    programme: { surface: true, store: true },
    project: { surface: true, store: false },
  },
} as unknown as Capabilities;

describe("capability field/entity gating", () => {
  it("reports surface and store per field", () => {
    expect(canSurfaceField(caps, "dueDate")).toBe(true);
    expect(canStoreField(caps, "dueDate")).toBe(true);
    expect(canSurfaceField(caps, "completionPct")).toBe(true);
    expect(canStoreField(caps, "completionPct")).toBe(false); // read-only
    expect(canSurfaceField(caps, "storyPoints")).toBe(false); // hidden
  });

  it("reports surface and store per entity", () => {
    expect(canSurfaceEntity(caps, "programme")).toBe(true);
    expect(canStoreEntity(caps, "project")).toBe(false);
  });

  it("falls back to permissive when caps or the key is missing", () => {
    expect(canSurfaceField(undefined, "dueDate")).toBe(true);
    expect(canSurfaceField(caps, "unknownField")).toBe(true);
    expect(canSurfaceEntity(caps, "unknownEntity")).toBe(true);
    // explicit strict fallback when asked
    expect(canSurfaceEntity(undefined, "programme", false)).toBe(false);
  });
});
