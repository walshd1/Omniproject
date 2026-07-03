import type { ActorContext, Broker, PortfolioRow } from "../broker/types";
import { mintAutonomousContext } from "./autonomous";
import { getNotifyBus } from "./notify-bus";
import { recordAudit } from "./audit";
import { logger } from "./logger";
import { ROLES, type Role } from "./rbac";

/**
 * Proactive "what needs me" digest.
 *
 * The overworked PM/PgM lives in email/Slack/Teams, not in a dashboard tab. This is the
 * PUSH the product owes them: a concise, PRIORITISED roll-up of what actually needs their
 * attention — at-risk (amber/red) projects, active blockers, overdue/slipping schedules,
 * budget breaches — delivered over the existing notification dispatch seam (the `digest`
 * kind + its default route → email/Slack/Teams via the broker's delivery). No dashboard
 * visit required.
 *
 * Design mirrors health-watch and exec-digest deliberately:
 *  - a PURE builder over the read model (buildProactiveDigest) that is deterministic and
 *    testable without a broker; thresholds are declarative and injectable;
 *  - a run that mints the KEYED, short-lived, viewer-roled autonomous principal
 *    `automation:proactive-digest` (allowlisted in lib/autonomous) to read the portfolio —
 *    no human session, no stored token, READ-ONLY (no write path to project data);
 *  - dispatch through the generic notify bus with kind "digest", so routing/consent stays
 *    above the seam and delivery below it. We never open a new egress path.
 *
 * OPT-OUT by a safe default: unlike the exec digest, this fires on a sensible default
 * cadence (weekly, Monday-morning-ish) with no env flag needed — an operator turns it OFF
 * by setting PROACTIVE_DIGEST_INTERVAL_HOURS=0. The default reach is the `manager` audience
 * (the PMs/PgMs), tunable via the route. Because a healthy portfolio produces an EMPTY
 * digest that is SKIPPED, "on by default" never means "noise by default".
 *
 * Zero-at-rest: the summary carries only bounded, prioritised counts + a short list of the
 * worst project names (which the recipient already governs), never task detail or ids.
 */

/** How the PM reads their portfolio — the RAG bucket a project row sits in. */
const rag = (r: PortfolioRow): "red" | "amber" | "green" => {
  const s = r.ragStatus.trim().toLowerCase();
  return s === "red" ? "red" : s === "amber" ? "amber" : "green";
};

export interface DigestThresholds {
  /** Schedule slip (days late) at/above which a project counts as overdue/slipping. */
  scheduleSlipDays: number;
  /** Budget overrun (%) at/above which a project counts as a budget breach. */
  budgetOverrunPct: number;
  /** Active blockers at/above which a project's blockers are called out. */
  blockers: number;
  /** Cap on how many project names each section names, to keep the digest scannable. */
  maxNamed: number;
}

/** Safe, PM-friendly defaults — a slip of a working week, a 10% budget breach, any blocker. */
export const DEFAULT_DIGEST_THRESHOLDS: DigestThresholds = {
  scheduleSlipDays: 5,
  budgetOverrunPct: 10,
  blockers: 1,
  maxNamed: 5,
};

// The active thresholds — defaults, optionally tuned per deployment (admin/config), so an
// operator can match their SLAs without a rebuild. Mirrors health-watch's tuning surface.
let activeThresholds: DigestThresholds = { ...DEFAULT_DIGEST_THRESHOLDS };

/** The thresholds the digest currently runs with. */
export function getDigestThresholds(): DigestThresholds {
  return { ...activeThresholds };
}

/** Tune the thresholds. Only finite, non-negative numbers are accepted; anything
 *  missing/invalid falls back to the default for that field. */
export function setDigestThresholds(input: unknown): DigestThresholds {
  const o = (input ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  activeThresholds = {
    scheduleSlipDays: num(o["scheduleSlipDays"], DEFAULT_DIGEST_THRESHOLDS.scheduleSlipDays),
    budgetOverrunPct: num(o["budgetOverrunPct"], DEFAULT_DIGEST_THRESHOLDS.budgetOverrunPct),
    blockers: num(o["blockers"], DEFAULT_DIGEST_THRESHOLDS.blockers),
    maxNamed: Math.max(1, Math.round(num(o["maxNamed"], DEFAULT_DIGEST_THRESHOLDS.maxNamed))),
  };
  return getDigestThresholds();
}

/** Test-only: restore default thresholds. */
export function __resetDigestThresholds(): void {
  activeThresholds = { ...DEFAULT_DIGEST_THRESHOLDS };
}

/** One prioritised section of the digest: what it's about, the count, and the worst offenders. */
export interface DigestSection {
  id: "at-risk" | "blockers" | "overdue" | "budget";
  label: string;
  count: number;
  /** Up to `maxNamed` worst project names (which the recipient already governs). */
  named: string[];
}

export interface ProactiveDigest {
  /** The notification kind — always "digest" (registered in the kind registry). */
  kind: "digest";
  /** The RBAC role this digest is aimed at (drives the dispatch audience). */
  role: Role;
  title: string;
  body: string;
  /** True when nothing needs attention — the caller SKIPS delivery so silence stays silent. */
  empty: boolean;
  /** The prioritised sections, most-urgent first (empty sections are omitted). */
  sections: DigestSection[];
  /** Bounded aggregates, for the API response / tests (never task detail or ids). */
  stats: { total: number; atRisk: number; blockers: number; overdue: number; budgetBreach: number };
}

const cap = (names: string[], max: number): string[] => names.slice(0, Math.max(1, max));

/**
 * Build the "what needs me" digest from portfolio rows (PURE).
 *
 * `role` frames the digest for its recipient (a manager/PgM sees their portfolio). `at` is an
 * ISO timestamp for the heading. Rows are prioritised into at-risk → blockers → overdue →
 * budget sections; each carries a bounded count + the worst project names. A portfolio where
 * everything is healthy yields `empty: true` so the caller can skip a "nothing to report" ping.
 */
export function buildProactiveDigest(
  rows: PortfolioRow[],
  at: string,
  role: Role = "manager",
  thresholds: DigestThresholds = DEFAULT_DIGEST_THRESHOLDS,
): ProactiveDigest {
  // Worst-first ordering within a section: red before amber, then by the relevant magnitude.
  const bySeverity = (a: PortfolioRow, b: PortfolioRow): number => {
    const w = (r: PortfolioRow) => (rag(r) === "red" ? 2 : rag(r) === "amber" ? 1 : 0);
    return w(b) - w(a);
  };

  const atRisk = rows.filter((r) => rag(r) !== "green").sort(bySeverity);
  const blocked = rows.filter((r) => r.activeBlockersCount >= thresholds.blockers)
    .sort((a, b) => b.activeBlockersCount - a.activeBlockersCount);
  const overdue = rows.filter((r) => r.scheduleVarianceDays >= thresholds.scheduleSlipDays)
    .sort((a, b) => b.scheduleVarianceDays - a.scheduleVarianceDays);
  const budget = rows.filter((r) => r.budgetVariancePercentage >= thresholds.budgetOverrunPct)
    .sort((a, b) => b.budgetVariancePercentage - a.budgetVariancePercentage);

  const sections: DigestSection[] = [
    { id: "at-risk" as const, label: "At-risk projects (amber/red)", rows: atRisk },
    { id: "blockers" as const, label: "Projects with active blockers", rows: blocked },
    { id: "overdue" as const, label: "Overdue / slipping schedules", rows: overdue },
    { id: "budget" as const, label: "Budget breaches", rows: budget },
  ]
    .filter((s) => s.rows.length > 0)
    .map((s) => ({ id: s.id, label: s.label, count: s.rows.length, named: cap(s.rows.map((r) => r.projectName), thresholds.maxNamed) }));

  const stats = {
    total: rows.length,
    atRisk: atRisk.length,
    blockers: blocked.length,
    overdue: overdue.length,
    budgetBreach: budget.length,
  };

  const empty = sections.length === 0;

  const title = empty
    ? "Nothing needs you right now"
    : `What needs you — ${stats.atRisk} at risk across ${stats.total} project(s)`;

  const body = empty
    ? `As of ${at}: all ${stats.total} project(s) look healthy — no at-risk, blocked, overdue or over-budget work. Nothing to action.`
    : [
        `As of ${at}, here's what needs your attention across ${stats.total} project(s):`,
        ...sections.map((s) => `• ${s.label}: ${s.count} — ${s.named.join(", ")}${s.count > s.named.length ? ", …" : ""}`),
      ].join("\n");

  return { kind: "digest", role, title, body, empty, sections, stats };
}

export interface RunDigestOptions {
  broker: Broker;
  now: number;
  /** RBAC role the digest is aimed at (default manager — the PMs/PgMs). */
  role?: Role | undefined;
  /** Thresholds to build with (defaults to the tuned/active thresholds). */
  thresholds?: DigestThresholds;
  /** Send an empty digest anyway (default false — a healthy portfolio stays silent). */
  sendWhenEmpty?: boolean;
  /** Deliver the digest (defaults to the notify bus); injectable for tests. */
  publish?: (notification: { kind: string; title: string; body: string; target?: { role?: Role } }) => Promise<unknown> | unknown;
}

export interface RunDigestResult {
  digest: ProactiveDigest;
  /** Whether the digest was actually dispatched (an empty one is skipped by default). */
  dispatched: boolean;
}

/**
 * Read the portfolio under a keyed autonomous principal, build the "what needs me" digest,
 * and dispatch it over the notify bus (kind "digest") targeted at the recipient role — unless
 * it's empty (then it's skipped, so a healthy portfolio never pings). Read-only; audited.
 */
export async function runProactiveDigest(opts: RunDigestOptions): Promise<RunDigestResult> {
  const role = opts.role ?? "manager";
  const ctx: ActorContext = mintAutonomousContext(
    { id: "proactive-digest", role: "viewer", reason: "scheduled proactive what-needs-me digest" },
    opts.now,
  );
  const rows = await opts.broker.portfolioHealth(ctx);
  const at = new Date(opts.now).toISOString();
  const digest = buildProactiveDigest(rows, at, role, opts.thresholds ?? getDigestThresholds());

  const dispatched = !digest.empty || opts.sendWhenEmpty === true;
  if (dispatched) {
    const publish = opts.publish ?? ((n) =>
      getNotifyBus().publish({
        notification: { kind: n.kind, title: n.title, body: n.body, id: `proactive-digest-${opts.now}`, read: false, timestamp: at } as never,
        target: { role: n.target?.role },
      }));
    await publish({ kind: digest.kind, title: digest.title, body: digest.body, target: { role } });
  }

  recordAudit({
    ts: at, category: "autonomous", action: "proactive-digest.run",
    actor: { sub: ctx.sub, role: ctx.role }, write: false, result: "success",
    meta: { projects: digest.stats.total, atRisk: digest.stats.atRisk, dispatched },
  });
  return { digest, dispatched };
}

// Default cadence: weekly (Monday-morning cadence for the working week). On by default —
// an operator opts OUT by setting PROACTIVE_DIGEST_INTERVAL_HOURS=0.
const DEFAULT_INTERVAL_HOURS = 24 * 7;

/** The configured cadence in hours: the env override when a valid non-negative number,
 *  else the weekly default. 0 = disabled (opt-out). */
export function digestIntervalHours(): number {
  const raw = process.env["PROACTIVE_DIGEST_INTERVAL_HOURS"]?.trim();
  if (raw === undefined || raw === "") return DEFAULT_INTERVAL_HOURS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return DEFAULT_INTERVAL_HOURS;
  return hours;
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the in-process digest timer (single-instance / homelab). ON by the weekly default;
 * `PROACTIVE_DIGEST_INTERVAL_HOURS=0` turns it OFF (opt-out). Returns true if started. Errors
 * in a run are logged, never fatal. For a fleet, set the interval to 0 and drive it from an
 * external scheduler hitting the trigger endpoint, so it fires once rather than once per replica.
 */
export function startProactiveDigestScheduler(run: () => Promise<unknown>): boolean {
  const hours = digestIntervalHours();
  if (hours <= 0) return false;
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void run().catch((err) => logger.warn({ err }, "proactive-digest run failed")); }, hours * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref(); // don't keep the process alive for the timer
  logger.info({ everyHours: hours }, "proactive-digest: scheduled in-process (opt-out; set PROACTIVE_DIGEST_INTERVAL_HOURS=0 to disable, or use the trigger endpoint + external cron for a fleet)");
  return true;
}

/** Test-only: stop the timer. */
export function __stopProactiveDigestScheduler(): void { if (timer) { clearInterval(timer); timer = null; } }
