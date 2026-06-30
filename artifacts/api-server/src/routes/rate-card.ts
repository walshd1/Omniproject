import { Router } from "express";
import { requireRole, roleForReq } from "../lib/rbac";
import { getSession } from "./auth";
import { recordAudit } from "../lib/audit";
import { getIssues, getProjects } from "../lib/data";
import { programmeIdOf } from "../lib/programmes";
import { staffCost, valueColumns, type RateCard, type Facing, type TimedItem, type Uplift, type ValueColumn } from "../lib/rate-card";
import { applyCostRules, firedCostRuleIds, type CostRule } from "../lib/cost-rules";
import { validatePredicate, type ConditionSet } from "../lib/predicate";
import {
  getRateCard,
  setRateCard,
  getProjectTypes,
  setProjectTypes,
  getIdentityMap,
  setIdentityAssignments,
  projectTypeFor,
  setProjectType,
  valueModelFor,
  getUpliftConfig,
  resolveUplift,
  setCentralUplift,
  setScopeUplift,
  getCostRules,
  setCostRules,
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
    if (!isStr(o?.["id"]) || !isStr(o?.["label"])) continue;
    const values = readValueColumns(o["values"]);
    projectTypes.push({ id: o["id"] as string, label: o["label"] as string, ...(values.length ? { values } : {}) });
  }
  return { card: { titles, rates }, projectTypes };
}

/** Validate a project type's value columns — any number of {id, label, kind:cost|charge, uplift?}. */
function readValueColumns(raw: unknown): ValueColumn[] {
  const out: ValueColumn[] = [];
  for (const v of (Array.isArray(raw) ? raw : []) as unknown[]) {
    const o = v as Record<string, unknown>;
    if (!isStr(o?.["id"]) || !isStr(o?.["label"]) || (o["kind"] !== "cost" && o["kind"] !== "charge")) continue;
    const col: ValueColumn = { id: o["id"] as string, label: o["label"] as string, kind: o["kind"] as "cost" | "charge" };
    const u = o["uplift"] as Record<string, unknown> | undefined;
    const upliftPart: Partial<Uplift> = {};
    if (isNum(u?.["margin"]) && (u!["margin"] as number) >= 0) upliftPart.margin = u!["margin"] as number;
    if (isNum(u?.["overhead"]) && (u!["overhead"] as number) >= 0) upliftPart.overhead = u!["overhead"] as number;
    if (col.kind === "charge" && (upliftPart.margin !== undefined || upliftPart.overhead !== undefined)) col.uplift = upliftPart;
    out.push(col);
  }
  return out;
}

/** Read a clamped uplift ({margin, overhead} as non-negative fractions) from a body object. */
function readUplift(o: Record<string, unknown> | undefined): Partial<Uplift> {
  const out: Partial<Uplift> = {};
  if (isNum(o?.["margin"]) && (o!["margin"] as number) >= 0) out.margin = o!["margin"] as number;
  if (isNum(o?.["overhead"]) && (o!["overhead"] as number) >= 0) out.overhead = o!["overhead"] as number;
  return out;
}

router.get("/rate-card", requireRole("pmo"), (_req, res) => {
  res.json({ ...getRateCard(), projectTypes: getProjectTypes(), uplift: getUpliftConfig() });
});

router.put("/rate-card", requireRole("pmo"), (req, res) => {
  const { card, projectTypes } = readRateCard(req.body);
  setRateCard(card);
  setProjectTypes(projectTypes);
  // Central margin/overhead may ride along on the same PUT.
  const u = readUplift((req.body as Record<string, unknown>)?.["uplift"] as Record<string, unknown> | undefined);
  if (u.margin !== undefined || u.overhead !== undefined) setCentralUplift({ margin: u.margin ?? 0, overhead: u.overhead ?? 0 });
  audit(req, "rate_card.update", { titles: Object.keys(card.titles).length, projectTypes: projectTypes.length });
  res.json({ ...getRateCard(), projectTypes: getProjectTypes(), uplift: getUpliftConfig() });
});

/** Override the margin/overhead for one programme/project scope (an empty body clears the override). */
router.put("/rate-card/uplift/:level/:scopeId", requireRole("pmo"), (req, res) => {
  const level = req.params["level"];
  if (level !== "programme" && level !== "project") { res.status(400).json({ error: "level must be programme | project" }); return; }
  const scopeId = String(req.params["scopeId"] ?? "");
  if (!scopeId) { res.status(400).json({ error: "scopeId is required" }); return; }
  setScopeUplift(level, scopeId, readUplift(req.body as Record<string, unknown>));
  audit(req, "rate_card.uplift.update", { level, scopeId });
  res.json({ ok: true, level, scopeId, uplift: getUpliftConfig() });
});

/** The PMO's general cost rules (predicate → uplift override). */
router.get("/rate-card/cost-rules", requireRole("pmo"), (_req, res) => {
  res.json({ costRules: getCostRules() });
});

/** Validate + read the cost-rule list (any number of {id, when?, effect}). */
function readCostRules(raw: unknown): CostRule[] {
  const out: CostRule[] = [];
  for (const r of (Array.isArray(raw) ? raw : []) as unknown[]) {
    const o = r as Record<string, unknown>;
    if (!isStr(o?.["id"])) throw new Error("each cost rule needs an id");
    const effectIn = (o["effect"] ?? {}) as Record<string, unknown>;
    const effect: CostRule["effect"] = {};
    if (isNum(effectIn["margin"]) && (effectIn["margin"] as number) >= 0) effect.margin = effectIn["margin"] as number;
    if (isNum(effectIn["overhead"]) && (effectIn["overhead"] as number) >= 0) effect.overhead = effectIn["overhead"] as number;
    const rule: CostRule = { id: o["id"] as string, effect };
    if (isStr(o["label"])) rule.label = o["label"] as string;
    const when = o["when"] as ConditionSet | undefined;
    if (when && typeof when === "object") {
      for (const p of [...(when.all ?? []), ...(when.any ?? [])]) {
        const err = validatePredicate(p);
        if (err) throw new Error(`cost rule "${rule.id}": ${err}`);
      }
      rule.when = { ...(when.all ? { all: when.all } : {}), ...(when.any ? { any: when.any } : {}) };
    }
    out.push(rule);
  }
  return out;
}

router.put("/rate-card/cost-rules", requireRole("pmo"), (req, res) => {
  try {
    const rules = readCostRules((req.body as Record<string, unknown>)?.["costRules"]);
    setCostRules(rules);
    audit(req, "rate_card.cost_rules.update", { count: rules.length });
    res.json({ costRules: getCostRules() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid cost rules" });
  }
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
    const project = (projects.find((p) => String(p["id"]) === projectId) ?? {}) as Record<string, unknown>;
    const programmeId = programmeIdOf(project);
    const scope = { programmeId, projectId };
    const projectType = projectTypeFor(projectId);

    // The cost-rule context: scope + projectType + a computed budget + every scalar project attribute the
    // backend exposes (so a rule can match on region, intraCompany, a custom flag, … — fully general).
    const budget = (issues as TimedItem[]).reduce((s, it) => s + (typeof (it as { budget?: number }).budget === "number" ? (it as { budget?: number }).budget! : 0), 0);
    const ctx: Record<string, unknown> = { programmeId, projectId, projectType, budget };
    for (const [k, v] of Object.entries(project)) if (v == null || typeof v !== "object") ctx[k] = v;

    // Base uplift (central → programme → project), then the general PMO cost rules override it for matches.
    const rules = getCostRules();
    const uplift = applyCostRules(resolveUplift(scope), rules, ctx);

    const cost = staffCost(issues as unknown as TimedItem[], getRateCard(), getIdentityMap(), projectType, uplift, scope);
    const columns = valueColumns(cost, valueModelFor(projectId), uplift);
    res.json({ ...cost, projectType, columns, appliedCostRules: firedCostRuleIds(rules, ctx) });
  } catch (err) {
    req.log.error({ err }, "staff_cost failed");
    res.status(502).json({ error: "Could not compute staff cost" });
  }
});

export default router;
