import type { Broker, PortfolioRow } from "../broker/types";
import { type Role } from "./rbac";
import { runScheduledAutonomousJob, createIntervalScheduler } from "./scheduled-job";
import { deliverDigestEmail } from "./digest-delivery";
import type { Mailer } from "./email";
import { logger } from "./logger";

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
 *  missing/invalid falls back to the default for that field (logged — a malformed
 *  admin edit that appears to apply but silently keeps the old threshold is a footgun). */
export function setDigestThresholds(input: unknown): DigestThresholds {
  const o = (input ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const invalid = (["scheduleSlipDays", "budgetOverrunPct", "blockers", "maxNamed"] as const)
    .filter((k) => o[k] !== undefined && !(typeof o[k] === "number" && Number.isFinite(o[k] as number) && (o[k] as number) >= 0));
  if (invalid.length) logger.warn({ fields: invalid }, "setDigestThresholds: ignoring invalid value(s), falling back to the default for those fields");
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

export interface CategorizedDigest {
  sections: DigestSection[];
  stats: ProactiveDigest["stats"];
  /** True when nothing needs attention. */
  empty: boolean;
}

/**
 * Categorize + aggregate portfolio rows into prioritised sections (PURE). Rows are bucketed
 * into at-risk → blockers → overdue → budget; each carries a bounded count + the worst project
 * names. A portfolio where everything is healthy yields `empty: true`.
 */
export function categorizeDigest(rows: PortfolioRow[], thresholds: DigestThresholds = DEFAULT_DIGEST_THRESHOLDS): CategorizedDigest {
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

  return { sections, stats, empty: sections.length === 0 };
}

/** Render the digest's title/body text from its categorized sections + stats (PURE). `at` is
 *  an ISO timestamp for the heading. */
export function renderDigestText(sections: DigestSection[], stats: ProactiveDigest["stats"], at: string): { title: string; body: string } {
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

  return { title, body };
}

/**
 * Build the "what needs me" digest from portfolio rows (PURE).
 *
 * `role` frames the digest for its recipient (a manager/PgM sees their portfolio). `at` is an
 * ISO timestamp for the heading.
 */
export function buildProactiveDigest(
  rows: PortfolioRow[],
  at: string,
  role: Role = "manager",
  thresholds: DigestThresholds = DEFAULT_DIGEST_THRESHOLDS,
): ProactiveDigest {
  const { sections, stats, empty } = categorizeDigest(rows, thresholds);
  const { title, body } = renderDigestText(sections, stats, at);
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
  /** Inject the SMTP mailer for the optional email-delivery step (tests). Production reads SMTP env. */
  mailer?: Mailer;
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
  const result = await runScheduledAutonomousJob({
    id: "proactive-digest",
    reason: "scheduled proactive what-needs-me digest",
    now: opts.now,
    auditAction: "proactive-digest.run",
    idPrefix: "proactive-digest",
    ...(opts.publish ? { publish: opts.publish } : {}),
    run: async (ctx) => {
      const rows = await opts.broker.portfolioHealth(ctx);
      const at = new Date(opts.now).toISOString();
      const digest = buildProactiveDigest(rows, at, role, opts.thresholds ?? getDigestThresholds());
      const dispatch = !digest.empty || opts.sendWhenEmpty === true
        ? { kind: digest.kind, title: digest.title, body: digest.body, target: { role } }
        : null;
      return {
        data: { digest },
        dispatch,
        auditMeta: (dispatched) => ({ projects: digest.stats.total, atRisk: digest.stats.atRisk, dispatched }),
      };
    },
  });
  // Optional above-seam email delivery — only when the digest was actually dispatched (an empty,
  // healthy digest stays silent on every channel). Best-effort; a no-op unless SMTP + recipients set.
  if (result.dispatched) {
    await deliverDigestEmail(
      { title: result.digest.title, body: result.digest.body },
      opts.mailer ? { mailer: opts.mailer } : {},
    ).catch((err) => logger.warn({ err }, "proactive-digest: email delivery failed"));
  }
  return result;
}

// Default cadence: weekly (Monday-morning cadence for the working week). On by default —
// an operator opts OUT by setting PROACTIVE_DIGEST_INTERVAL_HOURS=0.
const DEFAULT_INTERVAL_HOURS = 24 * 7;

const scheduler = createIntervalScheduler("PROACTIVE_DIGEST_INTERVAL_HOURS", DEFAULT_INTERVAL_HOURS, "proactive-digest");

/** The configured cadence in hours: the env override when a valid non-negative number,
 *  else the weekly default. 0 = disabled (opt-out). */
export function digestIntervalHours(): number {
  return scheduler.intervalHours();
}

/**
 * Start the in-process digest timer (single-instance / homelab). ON by the weekly default;
 * `PROACTIVE_DIGEST_INTERVAL_HOURS=0` turns it OFF (opt-out). Returns true if started. Errors
 * in a run are logged, never fatal. For a fleet, set the interval to 0 and drive it from an
 * external scheduler hitting the trigger endpoint, so it fires once rather than once per replica.
 */
export function startProactiveDigestScheduler(run: () => Promise<unknown>): boolean {
  return scheduler.start(run);
}

/** Test-only: stop the timer. */
export function __stopProactiveDigestScheduler(): void { scheduler.stop(); }
