/**
 * Runtime vendor overlay — lets a deployment ADD or OVERRIDE vendors at boot
 * without a rebuild, by registering parsed vendor definitions on top of the
 * shipped defaults. A deployment's config directory (read by the gateway) calls
 * `registerVendor` for each validated file; the plane accessors then return the
 * effective (defaults + overlay) set, so the override flows everywhere the
 * catalogue is read.
 *
 * Pure + in-memory: the catalogue holds the overlay in process memory only (the
 * JSON on disk is the durable copy the operator keeps). `validateVendor` checks a
 * candidate against the embedded plane schema — the same one the author designed
 * against — so a bad deployment file is rejected, not silently loaded.
 */
import { validate } from "./vendor-schema";
import { VENDOR_SCHEMAS } from "./vendor-schemas.generated";

/** The four vendor planes a deployment can overlay. */
export type VendorPlane = "backends" | "brokers" | "notifications" | "outputs";

const overlay: Record<VendorPlane, Map<string, { id: string }>> = {
  backends: new Map(),
  brokers: new Map(),
  notifications: new Map(),
  outputs: new Map(),
};

/** Validate a candidate vendor against its plane schema; returns error paths (empty = valid). */
export function validateVendor(plane: VendorPlane, data: unknown): string[] {
  const schema = VENDOR_SCHEMAS[plane];
  if (!schema) return [`unknown plane "${plane}"`];
  return validate(schema, data);
}

/** Register (add or override by id) one vendor on a plane. Throws if it fails its schema. */
export function registerVendor(plane: VendorPlane, data: { id: string }): void {
  const errs = validateVendor(plane, data);
  if (errs.length) throw new Error(`invalid ${plane} vendor "${data?.id}":\n  - ${errs.join("\n  - ")}`);
  overlay[plane].set(data.id, data);
}

/** Drop all registered overlays (used by tests and a config reload). */
export function clearVendorOverlay(): void {
  for (const m of Object.values(overlay)) m.clear();
}

/**
 * Merge a plane's overlay over its shipped defaults: an overlay entry overrides a
 * default with the same id; new ids are appended. Returns the base unchanged when
 * nothing is registered (the common case — zero overhead).
 */
export function withOverlay<T extends { id: string }>(plane: VendorPlane, base: readonly T[]): T[] {
  const extra = overlay[plane];
  if (extra.size === 0) return base as T[];
  const merged = new Map<string, T>(base.map((b) => [b.id, b]));
  for (const [id, def] of extra) merged.set(id, def as T);
  return [...merged.values()];
}

/** How many overlay entries are registered per plane (for the config-dir status). */
export function vendorOverlayCounts(): Record<VendorPlane, number> {
  return {
    backends: overlay.backends.size,
    brokers: overlay.brokers.size,
    notifications: overlay.notifications.size,
    outputs: overlay.outputs.size,
  };
}

/** The registered overlay vendors per plane (for the "lock this config" dump). */
export function vendorOverlayEntries(): Record<VendorPlane, Array<{ id: string }>> {
  return {
    backends: [...overlay.backends.values()],
    brokers: [...overlay.brokers.values()],
    notifications: [...overlay.notifications.values()],
    outputs: [...overlay.outputs.values()],
  };
}
