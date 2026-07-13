/**
 * Data-export endpoints — GET /api/export.{csv,xlsx,json,md,pdf} render the
 * projects/issues/activity datasets in each format for download. Thin shell; the
 * pure rendering (columns, matrix, serialisers) lives in lib/export-datasets — shared
 * with the scheduled export job — and the data in lib/data.
 */
import { Router, type Request, type Response } from "express";
import { getProjects, getIssues, getActivity, type Row } from "../lib/data";
import { allIssues } from "../lib/portfolio-reads";
import { guardProjectScope } from "../lib/project-scope";
import { traceFn } from "../broker/trace";
import { DATASET_META, buildWorkbook, EXPORT_FORMATS, type RenderableDataset } from "../lib/export-datasets";

const router = Router();

function send(res: Response, filename: string, type: string, body: Buffer | string) {
  res.setHeader("Content-Type", type);
  // Sanitize the filename before embedding it in the quoted header value: the dataset exporters
  // build it from the caller-supplied `projectId`, so a `"` would break out of filename="..." and
  // inject extra Content-Disposition parameters. Restrict to a filename-safe charset.
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.send(body);
}

const stamp = () => new Date().toISOString().slice(0, 10);

// ── GET /api/export.xlsx — one workbook: Projects + Issues + Activity ─────────
router.get("/export.xlsx", async (req, res) => {
  try {
    const projects = await getProjects(req);
    const [issues, activity] = await Promise.all([allIssues(req, projects), getActivity(req)]);
    send(
      res,
      `omniproject-${stamp()}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buildWorkbook(projects, issues, activity),
    );
  } catch (err) {
    req.log.error({ err }, "xlsx export failed");
    res.status(502).json({ error: "Export failed" });
  }
});

// ── Shared dataset resolver for the single-dataset exporters ──────────────────
async function resolveDataset(req: Request, dataset: string, projectId?: string): Promise<RenderableDataset | null> {
  const meta = DATASET_META[dataset];
  if (!meta) return null;
  let rows: Row[];
  if (dataset === "issues") rows = projectId ? await getIssues(req, projectId) : await allIssues(req);
  else if (dataset === "activity") rows = await getActivity(req);
  else rows = await getProjects(req);
  const base = `omniproject-${dataset}${dataset === "issues" && projectId ? `-${projectId}` : ""}-${stamp()}`;
  return { rows, cols: meta.cols, title: meta.title, base };
}

/** One handler for every single-dataset format — looks the serialiser up by extension. */
function datasetExport(format: string) {
  const exporter = EXPORT_FORMATS[format]!;
  // Trace/capture the serialiser as the `export` plane (same decorator as the seam).
  const render = traceFn("export", format, exporter.render);
  return async (req: Request, res: Response) => {
    const dataset = String(req.query["dataset"] ?? "projects");
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    // A projectId only narrows the issues dataset — and it bypasses the scope-bounded allIssues() with a
    // raw getIssues(projectId), so enforce caller scope here (else it's a cross-tenant issue export).
    if (dataset === "issues" && projectId && !(await guardProjectScope(req, res, projectId))) return;
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
for (const format of Object.keys(EXPORT_FORMATS)) router.get(`/export.${format}`, datasetExport(format));

export default router;
