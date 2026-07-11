import type { Broker, ActorContext } from "../broker/types";
import type { Row } from "./data";
import { mintAutonomousContext } from "./autonomous";
import { stampSource } from "../broker/identity";
import { DATASET_META, EXPORT_FORMATS, type RenderableDataset } from "./export-datasets";
import { deliverExportEmail } from "./digest-delivery";
import type { Mailer } from "./email";
import { createIntervalScheduler } from "./scheduled-job";
import { recordAudit } from "./audit";
import { logger } from "./logger";

/**
 * Scheduled data export — periodically renders a dataset (projects / issues / activity) in a chosen
 * format and EMAILS it as an attachment to the configured digest recipients. Read-only and
 * stateless-safe: it mints the same keyed, short-lived, viewer-roled autonomous principal the digests
 * use (no human session, no stored token), reads the dataset DIRECTLY through the neutral broker seam
 * (not the req-bound getters), renders via the shared lib/export-datasets serialisers, and delivers
 * above the seam via SMTP (a delivery channel, not persistence). Nothing is stored.
 *
 * OFF by default. `SCHEDULED_EXPORT_INTERVAL_HOURS>0` enables an in-process timer (single-instance);
 * for a fleet, leave it 0 and drive `POST /api/admin/scheduled-export/run` from an external scheduler
 * so it fires once, not once per replica. A no-op unless SMTP + `digestDelivery.emailRecipients` are set.
 */

const FORMATS = ["csv", "json", "md", "pdf"] as const;
type ExportFormat = (typeof FORMATS)[number];
const DATASETS = ["projects", "issues", "activity"] as const;
type ExportDataset = (typeof DATASETS)[number];

function configuredFormat(): ExportFormat {
  const f = process.env["SCHEDULED_EXPORT_FORMAT"]?.trim().toLowerCase();
  return (FORMATS as readonly string[]).includes(f ?? "") ? (f as ExportFormat) : "csv";
}
function configuredDataset(): ExportDataset {
  const d = process.env["SCHEDULED_EXPORT_DATASET"]?.trim().toLowerCase();
  return (DATASETS as readonly string[]).includes(d ?? "") ? (d as ExportDataset) : "projects";
}

/** Read the configured dataset directly through the broker under the autonomous context. */
async function readDataset(broker: Broker, ctx: ActorContext, dataset: ExportDataset): Promise<Row[]> {
  if (dataset === "activity") return broker.listActivity(ctx);
  if (dataset === "issues") {
    const projects = await broker.listProjects(ctx);
    const lists = await Promise.all(projects.map((p) => broker.listIssues(ctx, String(p.id))));
    return stampSource(lists.flat() as Row[], broker.kind);
  }
  return stampSource((await broker.listProjects(ctx)) as Row[], broker.kind);
}

export interface RunScheduledExportOptions {
  broker: Broker;
  now: number;
  format?: ExportFormat;
  dataset?: ExportDataset;
  /** Inject the SMTP mailer for tests; production reads SMTP env + settings recipients. */
  mailer?: Mailer;
}

export interface RunScheduledExportResult {
  dataset: ExportDataset;
  format: ExportFormat;
  rows: number;
  emailed: number;
}

/** Render + email one scheduled export. Read-only; audited. Returns what was produced/delivered. */
export async function runScheduledExport(opts: RunScheduledExportOptions): Promise<RunScheduledExportResult> {
  const format = opts.format ?? configuredFormat();
  const dataset = opts.dataset ?? configuredDataset();
  const ctx = mintAutonomousContext({ id: "scheduled-export", role: "viewer", reason: "scheduled data export" }, opts.now);

  const rows = await readDataset(opts.broker, ctx, dataset);
  const meta = DATASET_META[dataset]!;
  const stamp = new Date(opts.now).toISOString().slice(0, 10);
  const base = `omniproject-${dataset}-${stamp}`;
  const renderable: RenderableDataset = { rows, cols: meta.cols, title: meta.title, base };
  const content = EXPORT_FORMATS[format]!.render(renderable);

  const { emailed } = await deliverExportEmail({
    subject: `${meta.title} — ${stamp}`,
    body: `Attached: ${meta.title} (${rows.length} row(s)), exported ${new Date(opts.now).toISOString()}.`,
    attachment: { filename: `${base}.${format}`, content, contentType: EXPORT_FORMATS[format]!.contentType },
    ...(opts.mailer ? { mailer: opts.mailer } : {}),
  }).catch((err) => {
    logger.warn({ err }, "scheduled-export: email delivery failed");
    return { emailed: 0 };
  });

  recordAudit({
    ts: new Date(opts.now).toISOString(), category: "autonomous", action: "scheduled-export.run",
    actor: { sub: ctx.sub, role: ctx.role }, write: false, result: "success",
    meta: { dataset, format, rows: rows.length, emailed },
  });
  return { dataset, format, rows: rows.length, emailed };
}

// Off by default — an operator opts IN with SCHEDULED_EXPORT_INTERVAL_HOURS>0.
const scheduler = createIntervalScheduler("SCHEDULED_EXPORT_INTERVAL_HOURS", 0, "scheduled-export");

/** The configured cadence in hours (0 = disabled, the default). */
export function scheduledExportIntervalHours(): number {
  return scheduler.intervalHours();
}

/** Start the in-process export timer when SCHEDULED_EXPORT_INTERVAL_HOURS>0 (single-instance).
 *  Returns true if started. For a fleet, use the trigger endpoint + external cron. */
export function startScheduledExportScheduler(run: () => Promise<unknown>): boolean {
  return scheduler.start(run);
}

/** Test-only: stop the timer. */
export function __stopScheduledExportScheduler(): void { scheduler.stop(); }
