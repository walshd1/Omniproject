/**
 * Re-export of the ONE shared, artifact-agnostic roll-up (`@workspace/backend-catalogue`), so the backend
 * (rollup endpoints, exports) and the SPA (no-code report engine) run the SAME aggregation implementation —
 * a single roll-up behind every output of the system. Kept as a stable local import path for the routes.
 */
export { rollup, parseRollupQuery, aggregate, type Agg, type Metric, type RollupSpec } from "@workspace/backend-catalogue";
