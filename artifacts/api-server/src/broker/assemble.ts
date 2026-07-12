import { dedupeEntities, type ResolvedEntity } from "@workspace/backend-catalogue";
import type { Project } from "./types";

/**
 * Assemble project rows that came from DIFFERENT backends into one record per real project, keyed by the
 * backend-independent correlation GUID (`omniInstanceId`). A project seen through two backends carries
 * the same GUID, so its two rows merge into one assembled view (each contributing row is retained on
 * `records` so per-source provenance is never lost). A row with no GUID stands alone — no correlation
 * key, no safe merge.
 *
 * This lives BELOW the broker seam by design (PARKED-DECISIONS §D): cross-backend assembly is the
 * broker's job; the gateway stays structurally unaware of how many backends exist. It's a pure helper a
 * multi-backend broker uses to fold its fan-out into one read model.
 */
export function assembleByInstance(rows: Project[]): ResolvedEntity<Project>[] {
  return dedupeEntities(rows, (r) => (typeof r.omniInstanceId === "string" && r.omniInstanceId ? r.omniInstanceId : null));
}
