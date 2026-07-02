import { Router, type Request } from "express";
import { getProjects } from "../lib/data";
import { allIssues } from "../lib/portfolio-reads";
import { groupProgrammes } from "../lib/programmes";
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
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}/api/odata/`;
}

// Service document.
router.get("/odata", (req, res) => res.json(serviceDocument(ENTITIES, baseUrl(req))));
router.get("/odata/", (req, res) => res.json(serviceDocument(ENTITIES, baseUrl(req))));

// $metadata (EDMX).
router.get("/odata/$metadata", (_req, res) => {
  res.type("application/xml").send(buildEdmx(ENTITIES));
});

function entitySet(set: string, load: (req: Request) => Promise<Row[]>) {
  router.get(`/odata/${set}`, async (req, res) => {
    try {
      const { rows, count } = applyODataQuery(await load(req), req.query as ODataQuery);
      res.json(entitySetEnvelope(baseUrl(req), set, rows, count));
    } catch (err) {
      req.log.error({ err, set }, "odata query failed");
      res.status(502).json({ error: { message: "Feed unavailable" } });
    }
  });
}

entitySet("Projects", (req) => getProjects(req) as Promise<Row[]>);
entitySet("Issues", allIssues);
entitySet("Programmes", async (req) => groupProgrammes(await getProjects(req)) as unknown as Row[]);

export default router;
