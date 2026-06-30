import { Router } from "express";
import { requireRole, roleForReq } from "../lib/rbac";
import { getSession } from "./auth";
import { recordAudit } from "../lib/audit";
import { getIssues, getProjects } from "../lib/data";
import { programmeIdOf } from "../lib/programmes";
import { staffCost, type RateCard, type Facing, type TimedItem } from "../lib/rate-card";
import {
  getRateCard,
  setRateCard,
  getProjectTypes,
  setProjectTypes,
  getIdentityMap,
  setIdentityAssignments,
  projectTypeFor,
  setProjectType,
  type ProjectType,
} from "../lib/rate-card-store";

/**
 * Rate card + hashed identity→role map + project types, and the server-side staff time-and-cost
 * roll-up. Rates are the most sensitive config in the product, so they are **PMO-gated** and never
 * leave the gateway: the cost endpoint resolves rates in memory and returns only aggregated cost, so a
 * client never receives a rate. Identities are hashed at the store boundary.
 */
const router = Router();
const FACINGS: Facing[] = ["client", "internal"];

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);

function audit(req: Parameters<typeof getSession>[0], action: string, meta: Record<string, unknown>): void {
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action,
    actor: getSession(req) ? { sub: getSession(req)!.sub, role: roleForReq(req) } : null,
    result: "success",
    status: 200,
    meta,
  });
}

/** Validate the rate-card PUT body into a clean RateCard (titles + rates) and project types. */
function readRateCard(body: unknown): { card: RateCard; projectTypes: ProjectType[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const titles: Record<string, string> = {};
  for (const [k, v] of Object.entries((b["titles"] ?? {}) as Record<string, unknown>)) if (isStr(v)) titles[k] = v;
  const rates: RateCard["rates"] = {};
  for (const [titleHash, roleRates] of Object.entries((b["rates"] ?? {}) as Record<string, unknown>)) {
    const out: RateCard["rates"][string] = {};
    for (const [pt, byFacing] of Object.entries((roleRates ?? {}) as Record<string, unknown>)) {
      const cell: Partial<Record<Facing, number>> = {};
      for (const f of FACINGS) {
        const r = (byFacing as Record<string, unknown>)?.[f];
        if (isNum(r) && r >= 0) cell[f] = r;
      }
      if (Object.keys(cell).length) out[pt] = cell;
    }
    rates[titleHash] = out;
  }
  const projectTypes: ProjectType[] = [];
  for (const t of (b["projectTypes"] ?? []) as unknown[]) {
    const o = t as Record<string, unknown>;
    if (isStr(o?.["id"]) && isStr(o?.["label"])) projectTypes.push({ id: o["id"] as string, label: o["label"] as string });
  }
  return { card: { titles, rates }, projectTypes };
}

router.get("/rate-card", requireRole("pmo"), (_req, res) => {
  res.json({ ...getRateCard(), projectTypes: getProjectTypes() });
});

router.put("/rate-card", requireRole("pmo"), (req, res) => {
  const { card, projectTypes } = readRateCard(req.body);
  setRateCard(card);
  setProjectTypes(projectTypes);
  audit(req, "rate_card.update", { titles: Object.keys(card.titles).length, projectTypes: projectTypes.length });
  res.json({ ...getRateCard(), projectTypes: getProjectTypes() });
});

/** The hashed identity→role map (hashes only — no plaintext identities ever leave the store). */
router.get("/rate-card/identities", requireRole("pmo"), (_req, res) => {
  res.json(getIdentityMap());
});

router.put("/rate-card/identities", requireRole("pmo"), (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const level = b["level"];
  if (level !== "central" && level !== "programme" && level !== "project") {
    res.status(400).json({ error: "level must be central | programme | project" });
    return;
  }
  const scopeId = isStr(b["scopeId"]) ? (b["scopeId"] as string) : null;
  if (level !== "central" && !scopeId) { res.status(400).json({ error: "scopeId is required for programme/project" }); return; }
  const pairs: { assignee: string; titleHash: string }[] = [];
  for (const p of (b["assignments"] ?? []) as unknown[]) {
    const o = p as Record<string, unknown>;
    if (isStr(o?.["assignee"]) && isStr(o?.["titleHash"])) pairs.push({ assignee: o["assignee"] as string, titleHash: o["titleHash"] as string });
  }
  setIdentityAssignments(level, scopeId, pairs);
  audit(req, "rate_card.identities.update", { level, scopeId, count: pairs.length });
  res.json({ ok: true, level, scopeId, count: pairs.length });
});

/** A project's chosen type (any authed session can read; a manager sets it at setup). */
router.get("/projects/:projectId/type", (req, res) => {
  res.json({ projectId: req.params["projectId"], projectType: projectTypeFor(String(req.params["projectId"] ?? "")) });
});

router.put("/projects/:projectId/type", requireRole("manager"), (req, res) => {
  const projectId = String(req.params["projectId"] ?? "");
  const typeId = isStr((req.body as Record<string, unknown>)?.["projectType"]) ? ((req.body as Record<string, unknown>)["projectType"] as string) : "";
  const known = new Set(getProjectTypes().map((t) => t.id));
  if (typeId && !known.has(typeId)) { res.status(400).json({ error: `"${typeId}" is not a PMO-defined project type` }); return; }
  setProjectType(projectId, typeId);
  res.json({ projectId, projectType: projectTypeFor(projectId) });
});

/** Server-side staff time-and-cost roll-up for a project. PMO-gated; returns aggregated cost only. */
router.get("/projects/:projectId/staff-cost", requireRole("pmo"), async (req, res) => {
  try {
    const projectId = String(req.params["projectId"] ?? "");
    const [issues, projects] = await Promise.all([getIssues(req, projectId), getProjects(req)]);
    const programmeId = programmeIdOf((projects.find((p) => String(p["id"]) === projectId) ?? {}) as Record<string, unknown>);
    const cost = staffCost(issues as unknown as TimedItem[], getRateCard(), getIdentityMap(), projectTypeFor(projectId), { programmeId, projectId });
    res.json(cost);
  } catch (err) {
    req.log.error({ err }, "staff_cost failed");
    res.status(502).json({ error: "Could not compute staff cost" });
  }
});

export default router;
