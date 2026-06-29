import { Router } from "express";
import { getProjects, type Row } from "../lib/data";
import { getPortfolioHealth } from "./portfolio";
import { formatPrometheus, type AnyMetric } from "../lib/metrics";
import { runtimeMetrics } from "../lib/runtime-metrics";
import { ragBuckets } from "../broker/vocabulary";

/**
 * BI / observability integration endpoints.
 *
 *  - GET /api/metrics  — Prometheus exposition for Grafana (scrape with the
 *    read-only API token as a Bearer). Stateless: computed per request.
 *  - GET /api/bi/feeds — a manifest of JSON feeds for Power BI / Excel / Sheets
 *    (consumed via the Web/OData connector with a read-only API token).
 */

const router = Router();

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.get("/metrics", async (req, res) => {
  // RED metrics (rate/errors/duration) are pure in-process counters — emit them
  // FIRST and unconditionally so observability survives a backend outage.
  const runtime = runtimeMetrics();
  try {
    const projects = await getProjects(req);
    let issues = 0;
    let completed = 0;
    let members = 0;
    const perProject: { value: number; labels: Record<string, string> }[] = [];
    const perProjectDone: { value: number; labels: Record<string, string> }[] = [];
    for (const p of projects as Row[]) {
      const ic = num(p["issueCount"]);
      const cc = num(p["completedCount"]);
      issues += ic;
      completed += cc;
      members += num(p["memberCount"]);
      const labels = { project: String(p["id"] ?? ""), name: String(p["name"] ?? "") };
      perProject.push({ value: ic, labels });
      perProjectDone.push({ value: cc, labels });
    }

    // Portfolio RAG counts (best-effort).
    const rag: Record<string, number> = ragBuckets();
    try {
      for (const r of await getPortfolioHealth(req)) {
        if (r.ragStatus in rag) rag[r.ragStatus] = (rag[r.ragStatus] ?? 0) + 1;
      }
    } catch {
      /* portfolio not available — omit RAG */
    }

    const metrics: AnyMetric[] = [
      ...runtime,
      { name: "omniproject_build_info", help: "Build info", type: "gauge", samples: [{ value: 1, labels: { app: "omniproject" } }] },
      { name: "omniproject_projects_total", help: "Number of projects", type: "gauge", samples: [{ value: projects.length }] },
      { name: "omniproject_issues_total", help: "Total issues across projects", type: "gauge", samples: [{ value: issues }] },
      { name: "omniproject_issues_completed_total", help: "Completed issues across projects", type: "gauge", samples: [{ value: completed }] },
      { name: "omniproject_members_total", help: "Distinct members across projects", type: "gauge", samples: [{ value: members }] },
      { name: "omniproject_portfolio_rag", help: "Projects by RAG status", type: "gauge", samples: Object.entries(rag).map(([status, value]) => ({ value, labels: { status } })) },
      { name: "omniproject_project_issue_count", help: "Issues per project", type: "gauge", samples: perProject },
      { name: "omniproject_project_completed_count", help: "Completed issues per project", type: "gauge", samples: perProjectDone },
    ];

    res.type("text/plain; version=0.0.4").send(formatPrometheus(metrics));
  } catch (err) {
    // The backend read failed — still serve the RED metrics (200) so scrapers see
    // request/error/latency + the in-flight count during an outage, with a comment
    // noting the portfolio gauges are unavailable.
    req.log.error({ err }, "portfolio metrics collection failed; serving runtime metrics only");
    res.type("text/plain; version=0.0.4").send(formatPrometheus(runtime) + "# portfolio metrics unavailable (backend read failed)\n");
  }
});

router.get("/bi/feeds", (req, res) => {
  const origin = `${(req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol}://${req.headers["x-forwarded-host"] || req.get("host")}`;
  res.json({
    note: "Connect with a read-only API token (Authorization: Bearer <token> or X-API-Key). All feeds are GET-only.",
    feeds: [
      { name: "projects", format: "json", url: `${origin}/api/export.json?dataset=projects`, description: "Project portfolio" },
      { name: "issues", format: "json", url: `${origin}/api/export.json?dataset=issues`, description: "All issues" },
      { name: "activity", format: "json", url: `${origin}/api/export.json?dataset=activity`, description: "Activity feed" },
      { name: "portfolio_health", format: "json", url: `${origin}/api/portfolio/health`, description: "Portfolio RAG / variance" },
      { name: "workbook", format: "xlsx", url: `${origin}/api/export.xlsx`, description: "Excel workbook (Projects + Issues + Activity)" },
      { name: "prometheus_metrics", format: "prometheus", url: `${origin}/api/metrics`, description: "Grafana via Prometheus scrape" },
      { name: "odata_service", format: "odata", url: `${origin}/api/odata/`, description: "OData v4 feed for SAP / Dynamics / Oracle / Power BI (point your OData connector here; $metadata at /api/odata/$metadata)" },
    ],
  });
});

export default router;
