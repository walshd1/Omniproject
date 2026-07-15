import { Router, type Request } from "express";
import { getProjects, getIssues } from "../lib/data";
import { allIssues } from "../lib/portfolio-reads";
import { assertProjectScope } from "../lib/project-scope";
import { groupProgrammes } from "../lib/programmes";
import { baseUrl as resolveRequestBaseUrl } from "./auth";
import {
  buildEdmx,
  serviceDocument,
  applyODataQuery,
  entitySetEnvelope,
  type EntityModel,
  type Row,
  type ODataQuery,
} from "../lib/odata";

/**
 * OData v4 read service — so SAP / Dynamics / Oracle / Power BI can pull
 * OmniProject data in their native feed format (read-only API token works).
 * Endpoints: /api/odata/ (service doc), /$metadata, /Projects, /Issues,
 * /Programmes.
 */

const router = Router();

const ENTITIES: EntityModel[] = [
  {
    name: "Project",
    set: "Projects",
    key: "id",
    props: {
      id: "Edm.String", name: "Edm.String", identifier: "Edm.String", source: "Edm.String",
      programmeId: "Edm.String", programmeName: "Edm.String",
      issueCount: "Edm.Int32", completedCount: "Edm.Int32", memberCount: "Edm.Int32",
      updatedAt: "Edm.DateTimeOffset",
    },
  },
  {
    name: "Issue",
    set: "Issues",
    key: "id",
    props: {
      id: "Edm.String", projectId: "Edm.String", title: "Edm.String", status: "Edm.String",
      priority: "Edm.String", assignee: "Edm.String", source: "Edm.String",
      startDate: "Edm.String", dueDate: "Edm.String", createdAt: "Edm.DateTimeOffset", updatedAt: "Edm.DateTimeOffset",
    },
  },
  {
    name: "Programme",
    set: "Programmes",
    key: "id",
    props: {
      id: "Edm.String", name: "Edm.String", projectCount: "Edm.Int32", issueCount: "Edm.Int32",
      completedCount: "Edm.Int32", completionRate: "Edm.Double", ragStatus: "Edm.String",
    },
  },
];

function baseUrl(req: Request): string {
  return `${resolveRequestBaseUrl(req)}/api/odata/`;
}

// Service document.
router.get("/odata", (req, res) => res.json(serviceDocument(ENTITIES, baseUrl(req))));
router.get("/odata/", (req, res) => res.json(serviceDocument(ENTITIES, baseUrl(req))));

// $metadata (EDMX).
router.get("/odata/$metadata", (_req, res) => {
  res.type("application/xml").send(buildEdmx(ENTITIES));
});

/** Extract a top-level `projectId eq '<id>'` predicate from a $filter (the minimal grammar has no
 *  AND/OR), so a single-project feed query can be pushed down to a single-project read. */
function projectIdEq(q: ODataQuery): string | null {
  const m = q.$filter?.match(/^\s*projectId\s+eq\s+'?([^']+)'?\s*$/i);
  return m ? m[1]! : null;
}

function entitySet(set: string, load: (req: Request, q: ODataQuery) => Promise<Row[]>) {
  // The declared property allowlist for this set — rows are projected to exactly these before
  // serialising, so a backend's internal fields never ride out through the feed.
  const allowed = Object.keys(ENTITIES.find((e) => e.set === set)?.props ?? {});
  router.get(`/odata/${set}`, async (req, res) => {
    try {
      const q = req.query as ODataQuery;
      const { rows, count, nextSkip } = applyODataQuery(await load(req, q), q, allowed);
      // Server-driven paging: when the result was capped, hand back an absolute next-page link that
      // preserves the caller's other options ($filter/$select/$orderby/$count) with an advanced $skip.
      let nextLink: string | undefined;
      if (nextSkip !== undefined) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(q)) if (k !== "$skip" && typeof v === "string") params.set(k, v);
        params.set("$skip", String(nextSkip));
        nextLink = `${baseUrl(req)}${set}?${params.toString()}`;
      }
      res.json(entitySetEnvelope(baseUrl(req), set, rows, count, nextLink));
    } catch (err) {
      req.log.error({ err, set }, "odata query failed");
      res.status(502).json({ error: { message: "Feed unavailable" } });
    }
  });
}

entitySet("Projects", (req) => getProjects(req) as Promise<Row[]>);
entitySet("Issues", async (req, q) => {
  const pid = projectIdEq(q);
  // Push a single-project `$filter=projectId eq 'X'` down to a scoped single-project read instead of
  // fanning `allIssues` out over the WHOLE portfolio (a `$top=50` otherwise still materialises every
  // issue across every project). getIssues(pid) is scope-blind — mirror the export route's guard: an
  // out-of-scope project yields nothing (never leaks), exactly as allIssues+$filter would. The full
  // $filter still runs in applyODataQuery, so the result is identical, just without the fan-out.
  if (pid) return (await assertProjectScope(req, pid)).ok ? ((await getIssues(req, pid)) as Row[]) : [];
  return allIssues(req);
});
entitySet("Programmes", async (req) => groupProgrammes(await getProjects(req)) as unknown as Row[]);

export default router;
