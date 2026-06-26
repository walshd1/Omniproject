import type { Capabilities } from "@workspace/api-client-react";

/**
 * Field/entity gating helpers (RFC-001). The gateway reports, per backend,
 * whether each work-item field and higher-level entity can be **surfaced**
 * (read/displayed) and **stored** (written back). The UI uses these to hide
 * unsupported fields, render read-only ones, and drop entities (e.g. programmes)
 * a backend can't carry.
 *
 * Fallback is permissive (`true`): while capabilities load, or against an older
 * gateway that doesn't report a map, nothing is hidden — gating only kicks in
 * once the backend has explicitly said "no".
 */

export function canSurfaceField(caps: Capabilities | undefined, field: string, fallback = true): boolean {
  const f = caps?.fields?.[field];
  return f ? f.surface : fallback;
}

export function canStoreField(caps: Capabilities | undefined, field: string, fallback = true): boolean {
  const f = caps?.fields?.[field];
  return f ? f.store : fallback;
}

export function canSurfaceEntity(caps: Capabilities | undefined, entity: string, fallback = true): boolean {
  const e = caps?.entities?.[entity];
  return e ? e.surface : fallback;
}

export function canStoreEntity(caps: Capabilities | undefined, entity: string, fallback = true): boolean {
  const e = caps?.entities?.[entity];
  return e ? e.store : fallback;
}
