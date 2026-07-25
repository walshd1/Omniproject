import type { ActorContext } from "../broker/types";
import { getSettings } from "./settings";
import { isDigest } from "./release-promotion";
import { proposePromotion, type PromoteOutcome } from "./release-promotion";
import { captureReleaseBackup, runningDigest, type ReleaseBackup } from "./release-backup";
import { readOrgIdentity } from "./org-identity";
import { SealedFile, resolveConfigFile } from "./sealed-file";
import { safeParseJson } from "./safe-json";
import { recordAudit } from "./audit";
import { logger } from "./logger";

/**
 * Per-org test canary (docs/UPDATE-MECHANISM.md §5, phase 5).
 *
 * OmniProject is single-tenant (one deployment = one org), so a "per-org canary" is a per-DEPLOYMENT canary:
 * the new signed digest runs as a separate staging instance attached to an ISOLATED COPY of this org's data,
 * with writes discarded on reject and torn down on accept/reject. The container, the copied volume, and the
 * write-isolation are DEPLOY-LAYER concerns — the app can't (and shouldn't) fake multi-tenancy the rest of
 * the codebase doesn't have. What lives here is the honest app-layer surface:
 *
 *   1. a single tagged CANARY RECORD — the state machine `testing → accepted | rejected` (single-tenant ⇒ at
 *      most one canary at a time, exactly like `approvedPromotion` is one `current`),
 *   2. the SEED artifact — a sealed pre-adopt backup (`captureReleaseBackup`) the deploy layer mounts into the
 *      canary as its isolated data copy, and
 *   3. the ACCEPT funnel — acceptance delegates to the SAME human-only, passkey-gated `release.promote` chain,
 *      so a canary can never become a second, ungated path to production.
 *
 * The digest is the join key across canary → promotion → backup, as §3 intends.
 */

export const CANARY_SCHEMA = "omniproject/release-canary";
export const CANARY_VERSION = 1;

export type CanaryState = "testing" | "accepted" | "rejected";

export interface CanaryRecord {
  schema: typeof CANARY_SCHEMA;
  version: number;
  /** The digest under test (sha256:…) — what the canary container runs and what acceptance promotes. */
  digest: string;
  /** This deployment's org id (single-tenant) — records WHOSE data the canary copy was seeded from. */
  orgId: string;
  /** The digest the seed data belonged to when the canary started (the current production digest). */
  seedDigest: string | null;
  state: CanaryState;
  startedAt: string;
  /** Set when the canary leaves `testing` — acceptance or rejection time. */
  decidedAt?: string;
  decidedBy?: string;
}

/** Non-secret view of the current canary (safe for an admin API). */
export interface CanaryView {
  digest: string;
  orgId: string;
  seedDigest: string | null;
  state: CanaryState;
  startedAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

const store = new SealedFile(() => resolveConfigFile("RELEASE_CANARY_FILE"), "release canary");
let current: CanaryRecord | null = null;
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  const raw = store.read();
  if (raw === null) return;
  try {
    const p = safeParseJson(raw) as Partial<CanaryRecord>;
    if (p && p.schema === CANARY_SCHEMA && typeof p.digest === "string") current = p as CanaryRecord;
  } catch { /* keep null on a bad read */ }
}

function persist(): void {
  store.write(JSON.stringify(current));
}

/** The current canary record, or null when none is active/decided. */
export function currentCanary(): CanaryRecord | null {
  load();
  return current;
}

/** Non-secret view of the current canary, or null. */
export function canaryView(): CanaryView | null {
  const c = currentCanary();
  if (!c) return null;
  return { digest: c.digest, orgId: c.orgId, seedDigest: c.seedDigest, state: c.state, startedAt: c.startedAt, ...(c.decidedAt ? { decidedAt: c.decidedAt } : {}), ...(c.decidedBy ? { decidedBy: c.decidedBy } : {}) };
}

/** Test seam: clear the in-memory + loaded-once state. */
export function __resetCanary(): void { current = null; loaded = false; store.reset(); }

export interface StartCanaryOutcome {
  started: boolean;
  reason?: string;
  canary?: CanaryView;
  seed?: ReleaseBackup;
}

/**
 * Start a canary for `digest`: seed a sealed copy of the current state (the artifact the deploy layer mounts
 * into the isolated canary volume) and record `testing`. Refuses a second concurrent canary — single-tenant,
 * one at a time. Safe (read-then-seal), so admin-only and NOT approval-gated (like a backup capture).
 */
export function startCanary(_ctx: ActorContext, digest: string, now: string): StartCanaryOutcome {
  if (!isDigest(digest)) return { started: false, reason: "digest must be a content digest (sha256:…)" };
  load();
  if (current && current.state === "testing") {
    return { started: false, reason: `a canary is already testing ${current.digest} — accept or reject it first` };
  }
  // Seed the isolated data copy: a sealed pre-adopt backup tagged with the CURRENT (production) digest. The
  // deploy layer attaches this to the canary container as its own volume; writes there never touch prod.
  const seed = captureReleaseBackup(now, getSettings());
  current = {
    schema: CANARY_SCHEMA,
    version: CANARY_VERSION,
    digest,
    orgId: readOrgIdentity().id,
    seedDigest: runningDigest(),
    state: "testing",
    startedAt: now,
  };
  persist();
  recordAudit({ ts: now, category: "admin", action: "release.canary.started", write: true, result: "success", meta: { digest, orgId: current.orgId, seedDigest: current.seedDigest } });
  logger.info({ digest, orgId: current.orgId }, "release canary started (isolated data copy seeded)");
  return { started: true, canary: canaryView()!, seed };
}

export interface AcceptCanaryOutcome {
  accepted: boolean;
  reason?: string;
  /** The promotion outcome — held for sign-off (bound chain) or applied directly (unbound). */
  promotion?: PromoteOutcome;
}

/**
 * Accept the canary → promote its digest to production. Delegates to the EXISTING human-only, passkey-gated
 * `release.promote` chain (`proposePromotion`) — a canary is never a second ungated route to prod. The caller
 * (route) has already refused autonomous actors. The canary flips to `accepted`; the deploy layer reads that
 * to tear down the canary container and cut prod over to the (now-promoted) digest.
 */
export async function acceptCanary(ctx: ActorContext, now: string): Promise<AcceptCanaryOutcome> {
  load();
  if (!current || current.state !== "testing") return { accepted: false, reason: "no canary is currently testing" };
  const promotion = await proposePromotion(ctx, current.digest, `canary accepted for ${current.orgId}`);
  current = { ...current, state: "accepted", decidedAt: now, decidedBy: ctx.sub ?? "unknown" };
  persist();
  recordAudit({ ts: now, category: "admin", action: "release.canary.accepted", actor: { sub: ctx.sub }, write: true, result: "success", meta: { digest: current.digest, held: promotion.held } });
  logger.info({ digest: current.digest, held: promotion.held }, "release canary accepted → promotion proposed");
  return { accepted: true, promotion };
}

export interface RejectCanaryOutcome {
  rejected: boolean;
  reason?: string;
  canary?: CanaryView;
}

/**
 * Reject the canary → discard it. The canary flips to `rejected`; the deploy layer reads that to tear down the
 * canary container and DROP its isolated volume (the isolated writes are discarded — nothing durable was ever
 * made from them). Nothing is promoted. Human-only (the caller refuses autonomous actors).
 */
export function rejectCanary(ctx: ActorContext, now: string): RejectCanaryOutcome {
  load();
  if (!current || current.state !== "testing") return { rejected: false, reason: "no canary is currently testing" };
  current = { ...current, state: "rejected", decidedAt: now, decidedBy: ctx.sub ?? "unknown" };
  persist();
  recordAudit({ ts: now, category: "admin", action: "release.canary.rejected", actor: { sub: ctx.sub }, write: true, result: "success", meta: { digest: current.digest } });
  logger.info({ digest: current.digest }, "release canary rejected → isolated writes discarded");
  return { rejected: true, canary: canaryView()! };
}
