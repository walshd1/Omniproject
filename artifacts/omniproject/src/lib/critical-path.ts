/**
 * Critical Path Method (CPM) — re-export of the vendor-neutral solver.
 *
 * The implementation was promoted below the broker seam into
 * `@workspace/backend-catalogue` so every surface (SPA, API, report engine) shares one
 * pure solver instead of re-implementing it. This module keeps the historic SPA import
 * path (`../lib/critical-path`) stable for existing consumers.
 */
export {
  criticalPath,
  type CpmNode,
  type CpmEdge,
  type CpmNodeResult,
  type CpmResult,
} from "@workspace/backend-catalogue";
