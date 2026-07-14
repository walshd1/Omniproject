import { createHash, randomUUID } from "node:crypto";
import { evaluateRuleset } from "./ruleset";
import { createConcurrencyLimiter } from "./concurrency-pool";
import type { Broker, ActorContext, ProjectWrite } from "../broker/types";
import type { Role } from "./rbac";

/**
 * Declarative BULK-ACTION runner — the admin "do this canonical write to many projects at once"
 * JOB, separated from the HTTP shell (routes/bulk.ts). It is NOT a scripting engine: it composes
 * ONLY the existing gated broker writes (`create_project`, `update_project`), one canonical action
 * per item, exactly as a single hand-driven request would. So every safeguard still applies, per
 * item, by construction:
 *   - the broker it's handed is `getBroker()` — already wrapped with the autonomous-write guard,
 *     the data-seam scope-guard and the payload sanitizer, so no call can route around them;
 *   - the business ruleset (`evaluateRuleset`, restrict-only) is evaluated PER item — a freeze
 *     (`read-only`) or any hard rule skips that item, never forces it;
 *   - project scope is re-checked PER existing-project target (an out-of-scope id is skipped, not
 *     leaked) via the `inScope` predicate the route supplies over `assertProjectScope`.
 * Pure of Express and stateless: nothing is stored here — items flow straight to the broker. A
 * blocked/errored item is SKIPPED with its reason (partial success), never forced through.
 */

/** Hard cap on items per batch — each item is a broker write, so an unbounded array is a
 *  write-amplification DoS. Deliberately tighter than the 5 000-row import cap: a bulk admin
 *  action fans out project-level writes (heavier than a row insert). */
export const MAX_BULK_ITEMS = 500;

/** How many item-writes are ever in flight at once — matches the portfolio fan-out ceiling so a
 *  bulk batch can't thundering-herd the backend past what a normal portfolio read already does. */
export const BULK_FANOUT_LIMIT = 10;

/** The ProjectWrite fields a bulk patch may touch. NOTE: projects carry NO owner field in the
 *  neutral contract (only issues have `assignee`) — `programmeId` is the canonical grouping /
 *  reassignment field, the nearest thing to "re-own". `omniInstanceId` is deliberately excluded:
 *  it is server-minted per create and must never be client-supplied on an update. */
export const BULK_PATCH_FIELDS = ["name", "identifier", "description", "programmeId", "status"] as const;
export type BulkPatchField = (typeof BULK_PATCH_FIELDS)[number];

export type BulkActionKind = "update_project" | "create_project";

export interface BulkSpec {
  action: BulkActionKind;
  /** update_project: apply `patch` to each of these existing project ids. */
  targets?: string[];
  patch?: Record<string, unknown>;
  /** create_project: create one project per `name`, all sharing the `template` settings. */
  template?: Record<string, unknown>;
  names?: string[];
}

export type BulkItemStatus = "applied" | "skipped" | "error" | "preview-apply" | "preview-skip";

export interface BulkItemResult {
  index: number;
  action: BulkActionKind;
  /** The existing project id (update_project). */
  target?: string;
  /** The new project name (create_project). */
  name?: string;
  status: BulkItemStatus;
  /** The resulting project id (applied create/update). */
  id?: string;
  /** Why the item was skipped/errored. */
  reason?: string;
  /** The business-rule id that blocked it (when skipped by the ruleset). */
  rule?: string;
}

export interface BulkOutcome {
  total: number;
  applied: number;
  skipped: number;
  errored: number;
  results: BulkItemResult[];
}

/**
 * A stateless CONFIRMATION fingerprint of a spec: a hash over the canonical (order-independent)
 * spec content. It underpins the "secondary confirmation" gate — a real (non-dry-run) execute must
 * echo the fingerprint of the EXACT batch a dry-run previewed, so a bulk write can never fire in one
 * blind call. It's a deliberate-second-step control, not an auth secret (anyone with the spec can
 * compute it); zero-at-rest, so nothing is stored to enforce it. Targets/names are sorted so the
 * token depends on the SET of items, not their order.
 */
export function bulkFingerprint(spec: BulkSpec): string {
  const canonical = {
    action: spec.action,
    targets: [...(spec.targets ?? [])].map((t) => String(t)).sort(),
    names: [...(spec.names ?? [])].map((n) => String(n)).sort(),
    patch: pickPatch(spec.patch),
    template: pickPatch(spec.template),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface RunBulkInput {
  broker: Broker;
  ctx: ActorContext;
  role: Role;
  spec: BulkSpec;
  /** Preview only — validate + ruleset + scope each item and PROJECT the outcome without writing. */
  dryRun: boolean;
  /** Per-target scope predicate (the route closes over `assertProjectScope`). true ⇒ may touch it. */
  inScope: (projectId: string) => Promise<boolean>;
  /** Per-item error logger (the request log, typically). */
  onItemError?: (index: number, err: unknown) => void;
}

/** Keep only the allowlisted ProjectWrite fields from a caller-supplied object — a hostile/extra key
 *  (e.g. a client-forged omniInstanceId) can never reach the broker. */
function pickPatch(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of BULK_PATCH_FIELDS) {
    if (input && Object.prototype.hasOwnProperty.call(input, f) && input[f] !== undefined) out[f] = input[f];
  }
  return out;
}

/** Run ONE update_project item: scope → ruleset → broker. Returns its outcome (never throws). */
async function runUpdateItem(input: RunBulkInput, index: number, target: string, patch: Record<string, unknown>): Promise<BulkItemResult> {
  const base: BulkItemResult = { index, action: "update_project", target, status: "skipped" };
  if (!target) return { ...base, reason: "missing target project id" };
  // Per-target IDOR guard — an id the caller can't already see is skipped (not leaked, not 403'd
  // for the whole batch), the batched form of the single-request guardProjectScope.
  if (!(await input.inScope(target))) return { ...base, reason: "project not in your scope" };
  // Business ruleset (restrict-only) per item, exactly as a single PATCH would run.
  const verdict = evaluateRuleset({ action: "update_project", write: true, role: input.role, projectId: target, payload: patch });
  if (!verdict.allow) return { ...base, status: input.dryRun ? "preview-skip" : "skipped", reason: verdict.blocked!.message, rule: verdict.blocked!.id };
  if (input.dryRun) return { ...base, status: "preview-apply" };
  try {
    const updated = await input.broker.updateProject(input.ctx, target, patch as ProjectWrite);
    if (!updated?.id) return { ...base, status: "error", reason: "broker returned no project" };
    return { ...base, status: "applied", id: updated.id };
  } catch (err) {
    input.onItemError?.(index, err);
    return { ...base, status: "error", reason: err instanceof Error ? err.message : "broker error" };
  }
}

/** Run ONE create_project item: ruleset → broker (with a freshly-minted correlation GUID). */
async function runCreateItem(input: RunBulkInput, index: number, name: string, template: Record<string, unknown>): Promise<BulkItemResult> {
  const base: BulkItemResult = { index, action: "create_project", name, status: "skipped" };
  if (!name) return { ...base, reason: "missing project name" };
  const payload = { ...template, name };
  const verdict = evaluateRuleset({ action: "create_project", write: true, role: input.role, payload });
  if (!verdict.allow) return { ...base, status: input.dryRun ? "preview-skip" : "skipped", reason: verdict.blocked!.message, rule: verdict.blocked!.id };
  if (input.dryRun) return { ...base, status: "preview-apply" };
  try {
    // Mint the gateway correlation GUID here, once, exactly as POST /projects does — server-minted,
    // never from the caller. It uniquely identifies this create so N creates in a minute don't
    // collapse to one idempotency key (see idempotencyKey in reference-broker).
    const project = await input.broker.createProject(input.ctx, { ...payload, omniInstanceId: randomUUID() } as ProjectWrite);
    if (!project?.id) return { ...base, status: "error", reason: "broker returned no project" };
    return { ...base, status: "applied", id: project.id };
  } catch (err) {
    input.onItemError?.(index, err);
    return { ...base, status: "error", reason: err instanceof Error ? err.message : "broker error" };
  }
}

/**
 * Execute a bulk spec, at most {@link BULK_FANOUT_LIMIT} item-writes in flight at once, resolving in
 * input order. Each item is independent: one skip/error never aborts the batch (partial success).
 */
export async function runBulk(input: RunBulkInput): Promise<BulkOutcome> {
  const { spec } = input;
  // Bound the fan-out here so a barrier'd Promise.all can't thundering-herd the backend.
  const run = createConcurrencyLimiter(BULK_FANOUT_LIMIT);

  let results: BulkItemResult[];
  if (spec.action === "update_project") {
    const patch = pickPatch(spec.patch);
    const targets = spec.targets ?? [];
    results = await Promise.all(targets.map((target, i) => run(() => runUpdateItem(input, i, String(target ?? ""), patch))));
  } else {
    const template = pickPatch(spec.template);
    const names = spec.names ?? [];
    results = await Promise.all(names.map((name, i) => run(() => runCreateItem(input, i, String(name ?? ""), template))));
  }

  const applied = results.filter((r) => r.status === "applied" || r.status === "preview-apply").length;
  const errored = results.filter((r) => r.status === "error").length;
  const skipped = results.length - applied - errored;
  return { total: results.length, applied, skipped, errored, results };
}
