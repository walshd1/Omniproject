import type { ActorContext, Broker, PortfolioRow } from "../broker/types";
import { mintAutonomousContext } from "./autonomous";
import { getNotifyBus } from "./notify-bus";
import { deliverDigestEmail } from "./digest-delivery";
import type { Mailer } from "./email";
import { recordAudit } from "./audit";
import { logger } from "./logger";

/**
 * Scheduled executive digest — a periodic, read-only portfolio roll-up delivered over the
 * existing notification dispatch seam, so execs who never open the app still get the Monday
 * summary on their channel (email/Slack/Teams via the broker workflow's delivery).
 *
 * Stateless-safe: the run mints a short-lived, keyed, viewer-roled AUTONOMOUS principal (the
 * same mechanism health-watch uses) to read the portfolio — no human session, no stored token.
 * The summary holds only aggregates (counts, worst variances), never descriptions or ids.
 *
 * Off by default. `EXEC_DIGEST_INTERVAL_HOURS` > 0 enables an in-process timer (single-instance /
 * homelab); for a fleet, leave it off and have an external scheduler (cron / the broker) hit
 * `POST /api/admin/digest/run` instead, so the digest fires once rather than once per replica.
 */

export interface ExecDigest {
  kind: string;
  title: string;
  body: string;
  /** The aggregates, for the API response / tests (never any project detail). */
  stats: { total: number; red: number; amber: number; green: number; atRisk: number; worstScheduleSlipDays: number; worstBudgetOverrunPct: number; totalBlockers: number };
}

const rag = (r: PortfolioRow): string => r.ragStatus.trim().toLowerCase();

/** Build the digest from portfolio rows (pure). `at` is an ISO timestamp for the heading. */
export function buildExecDigest(rows: PortfolioRow[], at: string): ExecDigest {
  // One pass folds the rows into every counter/max (was six separate traversals). Same output.
  let red = 0, amber = 0, green = 0, worstScheduleSlipDays = 0, worstBudgetOverrunPct = 0, totalBlockers = 0;
  for (const r of rows) {
    const g = rag(r);
    if (g === "red") red++; else if (g === "amber") amber++; else if (g === "green") green++;
    if (r.scheduleVarianceDays > worstScheduleSlipDays) worstScheduleSlipDays = r.scheduleVarianceDays;
    if (r.budgetVariancePercentage > worstBudgetOverrunPct) worstBudgetOverrunPct = r.budgetVariancePercentage;
    totalBlockers += r.activeBlockersCount;
  }
  const atRisk = red + amber;
  const stats = { total: rows.length, red, amber, green, atRisk, worstScheduleSlipDays, worstBudgetOverrunPct, totalBlockers };

  const title = `Portfolio digest — ${atRisk}/${rows.length} project(s) at risk`;
  const body = [
    `As of ${at}:`,
    `• ${rows.length} project(s): ${green} green, ${amber} amber, ${red} red.`,
    `• ${atRisk} at risk (amber+red); ${totalBlockers} active blocker(s) across the portfolio.`,
    `• Worst schedule slip: ${worstScheduleSlipDays} day(s); worst budget overrun: ${worstBudgetOverrunPct}%.`,
  ].join("\n");

  return { kind: "info", title, body, stats };
}

export interface RunDigestOptions {
  broker: Broker;
  now: number;
  /** Deliver the digest (defaults to the notify bus); injectable for tests. */
  publish?: (notification: { kind: string; title: string; body: string }) => Promise<unknown> | unknown;
  /** Inject the SMTP mailer for the optional email-delivery step (tests). Production reads SMTP env. */
  mailer?: Mailer;
}

/** Read the portfolio under a keyed autonomous principal, build the digest, and dispatch it. */
export async function runExecDigest(opts: RunDigestOptions): Promise<ExecDigest> {
  const ctx: ActorContext = mintAutonomousContext({ id: "exec-digest", role: "viewer", reason: "scheduled executive digest" }, opts.now);
  const rows = await opts.broker.portfolioHealth(ctx);
  const at = new Date(opts.now).toISOString();
  const digest = buildExecDigest(rows, at);

  const publish = opts.publish ?? ((n) => getNotifyBus().publish({ notification: { ...n, id: `digest-${opts.now}`, body: n.body, read: false, timestamp: at } as never }));
  await publish({ kind: digest.kind, title: digest.title, body: digest.body });

  // Optional above-seam email delivery — best-effort, a no-op unless SMTP + recipients are configured.
  await deliverDigestEmail(
    { title: digest.title, body: digest.body },
    opts.mailer ? { mailer: opts.mailer } : {},
  ).catch((err) => logger.warn({ err }, "exec-digest: email delivery failed"));

  recordAudit({
    ts: at, category: "autonomous", action: "exec-digest.run",
    actor: { sub: ctx.sub, role: ctx.role }, write: false, result: "success",
    meta: { projects: digest.stats.total, atRisk: digest.stats.atRisk },
  });
  return digest;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the in-process digest timer when EXEC_DIGEST_INTERVAL_HOURS > 0 (single-instance).
 *  Returns true if started. Errors in a run are logged, never fatal. */
export function startExecDigestScheduler(run: () => Promise<unknown>): boolean {
  const hours = Number(process.env["EXEC_DIGEST_INTERVAL_HOURS"]);
  if (!Number.isFinite(hours) || hours <= 0) return false;
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void run().catch((err) => logger.warn({ err }, "exec-digest run failed")); }, hours * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref(); // don't keep the process alive for the timer
  logger.info({ everyHours: hours }, "exec-digest: scheduled in-process (single-instance; use the trigger endpoint + external cron for a fleet)");
  return true;
}

/** Test-only: stop the timer. */
export function __stopExecDigestScheduler(): void { if (timer) { clearInterval(timer); timer = null; } }
