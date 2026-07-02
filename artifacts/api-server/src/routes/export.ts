/**
 * Data-export endpoints — GET /api/export.{csv,xlsx,json,md,pdf} render the
 * projects/issues/activity datasets in each format for download. Thin shell; the
 * serialisers live in lib/{csv,xlsx,md,pdf}, the data in lib/data.
 */
import { Router, type Request, type Response } from "express";
import { getProjects, getIssues, getActivity, type Row } from "../lib/data";
import { allIssues } from "../lib/portfolio-reads";
import { toCsv, type CsvValue } from "../lib/csv";
import { buildXlsx, type Sheet } from "../lib/xlsx";
import { toMarkdown } from "../lib/md";
import { buildPdf } from "../lib/pdf";
import { traceFn } from "../broker/trace";

const router = Router();

// Column order for each dataset (also the export header row).
const PROJECT_COLS = ["id", "identifier", "name", "source", "issueCount", "completedCount", "memberCount", "description", "updatedAt"];
const ISSUE_COLS = ["id", "projectId", "title", "status", "priority", "assignee", "labels", "startDate", "dueDate", "source", "createdAt", "updatedAt"];
const ACTIVITY_COLS = ["id", "timestamp", "actor", "action", "projectId", "issueId", "issueTitle", "detail"];

function cell(value: unknown): CsvValue {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return value as CsvValue;
}

function toMatrix(items: Row[], cols: string[]): CsvValue[][] {
  return items.map((item) => cols.map((c) => cell(item[c])));
}

function send(res: Response, filename: string, type: string, body: Buffer | string) {
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

const stamp = () => new Date().toISOString().slice(0, 10);

// ── GET /api/export.xlsx — one workbook: Projects + Issues + Activity ─────────
router.get("/export.xlsx", async (req, res) => {
  try {
    const projects = await getProjects(req);
    const [issues, activity] = await Promise.all([allIssues(req, projects), getActivity(req)]);
    const sheets: Sheet[] = [
      { name: "Projects", headers: PROJECT_COLS, rows: toMatrix(projects, PROJECT_COLS) },
      { name: "Issues", headers: ISSUE_COLS, rows: toMatrix(issues, ISSUE_COLS) },
      { name: "Activity", headers: ACTIVITY_COLS, rows: toMatrix(activity, ACTIVITY_COLS) },
    ];
    send(
      res,
      `omniproject-${stamp()}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buildXlsx(sheets),
    );
  } catch (err) {
    req.log.error({ err }, "xlsx export failed");
    res.status(502).json({ error: "Export failed" });
  }
});

// ── Shared dataset resolver for the single-dataset exporters ──────────────────

const DATASETS: Record<string, { cols: string[]; title: string }> = {
  projects: { cols: PROJECT_COLS, title: "OmniProject — Projects" },
  issues: { cols: ISSUE_COLS, title: "OmniProject — Issues" },
  activity: { cols: ACTIVITY_COLS, title: "OmniProject — Activity" },
};

async function resolveDataset(
  req: Request,
  dataset: string,
  projectId?: string,
): Promise<{ rows: Row[]; cols: string[]; title: string; base: string } | null> {
  const meta = DATASETS[dataset];
  if (!meta) return null;
  let rows: Row[];
  if (dataset === "issues") rows = projectId ? await getIssues(req, projectId) : await allIssues(req);
  else if (dataset === "activity") rows = await getActivity(req);
  else rows = await getProjects(req);
  const base = `omniproject-${dataset}${dataset === "issues" && projectId ? `-${projectId}` : ""}-${stamp()}`;
  return { rows, cols: meta.cols, title: meta.title, base };
}

// ── Single-dataset exporters: a registry of format → serialiser. Adding a format
// is one entry + the route is derived from it. (xlsx is the one exception above —
// a multi-sheet workbook over ALL datasets, not a single parameterised dataset.)
type Dataset = { rows: Row[]; cols: string[]; title: string; base: string };

const EXPORTERS: Record<string, { contentType: string; render: (d: Dataset) => string | Buffer }> = {
  csv: { contentType: "text/csv; charset=utf-8", render: (d) => toCsv(d.cols, toMatrix(d.rows, d.cols)) },
  // Native JSON: the raw records (not the flattened matrix).
  json: { contentType: "application/json; charset=utf-8", render: (d) => JSON.stringify(d.rows, null, 2) },
  md: { contentType: "text/markdown; charset=utf-8", render: (d) => toMarkdown(d.title, d.cols, toMatrix(d.rows, d.cols)) },
  pdf: { contentType: "application/pdf", render: (d) => buildPdf({ title: d.title, headers: d.cols, rows: toMatrix(d.rows, d.cols) }) },
};

/** One handler for every single-dataset format — looks the serialiser up by extension. */
function datasetExport(format: string) {
  const exporter = EXPORTERS[format]!;
  // Trace/capture the serialiser as the `export` plane (same decorator as the seam).
  const render = traceFn("export", format, exporter.render);
  return async (req: Request, res: Response) => {
    const dataset = String(req.query["dataset"] ?? "projects");
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    try {
      const d = await resolveDataset(req, dataset, projectId);
      if (!d) {
        res.status(400).json({ error: "dataset must be projects, issues, or activity" });
        return;
      }
      send(res, `${d.base}.${format}`, exporter.contentType, render(d));
    } catch (err) {
      req.log.error({ err, dataset, format }, "export failed");
      res.status(502).json({ error: "Export failed" });
    }
  };
}

// GET /api/export.{csv,json,md,pdf}?dataset=projects|issues|activity[&projectId=]
for (const format of Object.keys(EXPORTERS)) router.get(`/export.${format}`, datasetExport(format));

export default router;
