import { Router, type Request, type Response } from "express";
import { getProjects, getIssues, getActivity, type Row } from "../lib/data";
import { toCsv, type CsvValue } from "../lib/csv";
import { buildXlsx, type Sheet } from "../lib/xlsx";

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

async function allIssues(req: Request): Promise<Row[]> {
  const projects = await getProjects(req);
  const lists = await Promise.all(projects.map((p) => getIssues(req, String((p as Row).id))));
  return lists.flat();
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
    const [projects, issues, activity] = await Promise.all([getProjects(req), allIssues(req), getActivity(req)]);
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

// ── GET /api/export.csv?dataset=projects|issues|activity[&projectId=] ─────────
router.get("/export.csv", async (req, res) => {
  const dataset = String(req.query["dataset"] ?? "projects");
  const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;

  try {
    let csv: string;
    let name: string;
    switch (dataset) {
      case "issues": {
        const issues = projectId ? await getIssues(req, projectId) : await allIssues(req);
        csv = toCsv(ISSUE_COLS, toMatrix(issues, ISSUE_COLS));
        name = `omniproject-issues${projectId ? `-${projectId}` : ""}-${stamp()}.csv`;
        break;
      }
      case "activity": {
        const activity = await getActivity(req);
        csv = toCsv(ACTIVITY_COLS, toMatrix(activity, ACTIVITY_COLS));
        name = `omniproject-activity-${stamp()}.csv`;
        break;
      }
      case "projects": {
        const projects = await getProjects(req);
        csv = toCsv(PROJECT_COLS, toMatrix(projects, PROJECT_COLS));
        name = `omniproject-projects-${stamp()}.csv`;
        break;
      }
      default:
        res.status(400).json({ error: "dataset must be projects, issues, or activity" });
        return;
    }
    send(res, name, "text/csv; charset=utf-8", csv);
  } catch (err) {
    req.log.error({ err, dataset }, "csv export failed");
    res.status(502).json({ error: "Export failed" });
  }
});

export default router;
