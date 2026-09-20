import { Router } from "express";
import { getBroker, contextFromReq, withBrokerErrors } from "../broker";
import { SettingsValidationError } from "../lib/settings";
import { isTimeTravelEnabled } from "../lib/logging-sync";
import { resolveHistoryRetention, sanitizeHistoryRetention, HISTORY_RETENTION_CONFIG_ID } from "../lib/history-retention";
import { applyConfigCollectionGuarded } from "../lib/config-guard";
import { requireArtifactStore } from "../lib/artifact-store";
import { captureVersion } from "../lib/config-store";
import { getSession } from "./auth";
import { requireRole, requireAnyRole, hasRole, scopeForReq } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { recordRequestAudit } from "../lib/audit";
import { isFeatureEnabled } from "../lib/feature-modules";
import { selfHostGovernanceId } from "../selfhost";
import { buildTrend, resolveCadence, retentionSourceFor, TREND_METRICS, type TrendGrain, type TrendMetric } from "../history";
import { disposeExpired, eraseEntityHistory, LegalHoldError, RetentionUnsupportedError } from "../history/lifecycle";
import { disposeAuditLog } from "../lib/audit-chain";

/**
 * Time-travel replay — read recorded portfolio states back from the operator's
 * logging server (via the broker). Gated: returns 409 unless the operator has
 * opted into the logging-server egress, since without it there is no recorded
 * history to replay. OmniProject stores nothing; it is a stateless lens over the
 * operator's log.
 */
const router = Router();

router.get("/history/replay", async (req, res) => {
  if (!isTimeTravelEnabled()) {
    res.status(409).json({ error: "Time-travel is not enabled. Enable the logging server in settings to retain and replay history." });
    return;
  }
  // Replay returns recorded PORTFOLIO-WIDE states (the retention read isn't per-tenant), so — exactly
  // like /history/trends — it requires portfolio (PMO/admin) scope.
  // Without this, any scoped principal (manager/user) could read the whole portfolio's retained
  // history: the same IDOR class already closed on /history/trends. Fail-closed.
  if (scopeForReq(req).level !== "all") {
    res.status(403).json({ error: "time-travel replay returns portfolio-wide history and requires portfolio (PMO/admin) scope" });
    return;
  }
  const from = typeof req.query["from"] === "string" ? (req.query["from"] as string) : undefined;
  const to = typeof req.query["to"] === "string" ? (req.query["to"] as string) : undefined;
  // Validate the window before it reaches the retention query (same discipline as /history/trends):
  // reject a non-ISO timestamp or an inverted range rather than forward garbage to the log store.
  const fromMs = from !== undefined ? Date.parse(from) : undefined;
  const toMs = to !== undefined ? Date.parse(to) : undefined;
  if ((fromMs !== undefined && Number.isNaN(fromMs)) || (toMs !== undefined && Number.isNaN(toMs))) {
    res.status(400).json({ error: "from/to must be ISO-8601 timestamps" });
    return;
  }
  if (fromMs !== undefined && toMs !== undefined && fromMs >= toMs) {
    res.status(400).json({ error: "from must be before to" });
    return;
  }
  await withBrokerErrors(req, res, "history replay failed", async () => {
    res.json(await getBroker().replay(contextFromReq(req), { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }));
  });
});

const GRAINS: readonly TrendGrain[] = ["day", "week", "month", "quarter"];

/** Cap the id fan-out: `readSnapshots` fires one paginated cloud query (S3 list / Dynamo Query) per
 *  id, so an unbounded `ids` turns a single request into thousands of concurrent backend calls. */
const MAX_TREND_IDS = 200;
/** Cap the number of buckets a single trend request can span (cheap span/grain estimate), so a
 *  far-past `from` can't silently truncate the series (the builder caps internally) or drive large
 *  O(buckets × snapshots) compute. */
const MAX_TREND_BUCKETS = 10_000;
const GRAIN_MS: Record<TrendGrain, number> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  quarter: 91 * 86_400_000,
};

/**
 * GET /history/trends/:metric — a bucketed trend series for a metric over a window. Gated on the
 * self-host `history` domain being enabled for the scope (that's what retains the time-series). When
 * it isn't enabled, or no retention source is configured, the series comes back `available: false`
 * with a reason — an honest "history not yet retained", not a 404 or fabricated zeroes. Access is
 * portfolio-scoped (PMO/admin only): the retention read is portfolio-wide, not per-tenant, so a scoped
 * principal can't read history by naming arbitrary entity ids.
 */
router.get("/history/trends/:metric", async (req, res) => {
  const metric = String(req.params["metric"]) as TrendMetric;
  if (!TREND_METRICS.includes(metric)) {
    res.status(400).json({ error: `unknown trend metric; one of: ${TREND_METRICS.join(", ")}` });
    return;
  }
  const grainParam = typeof req.query["grain"] === "string" ? (req.query["grain"] as TrendGrain) : "month";
  const grain: TrendGrain = GRAINS.includes(grainParam) ? grainParam : "month";
  const programmeId = (req.query["programmeId"] as string | undefined)?.trim() || null;
  const projectId = (req.query["projectId"] as string | undefined)?.trim() || null;
  const entity = (req.query["entity"] as string | undefined)?.trim() || "issue";
  const ids = typeof req.query["ids"] === "string" && req.query["ids"] ? (req.query["ids"] as string).split(",").filter(Boolean) : [];
  if (ids.length > MAX_TREND_IDS) {
    res.status(400).json({ error: `too many ids (max ${MAX_TREND_IDS})` });
    return;
  }
  const from = typeof req.query["from"] === "string" ? (req.query["from"] as string) : "1970-01-01T00:00:00Z";
  const to = typeof req.query["to"] === "string" ? (req.query["to"] as string) : new Date().toISOString();
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    res.status(400).json({ error: "from/to must be ISO-8601 timestamps" });
    return;
  }
  if (fromMs >= toMs) {
    res.status(400).json({ error: "from must be before to" });
    return;
  }
  if ((toMs - fromMs) / GRAIN_MS[grain] > MAX_TREND_BUCKETS) {
    res.status(400).json({ error: `window too large for grain "${grain}" (max ${MAX_TREND_BUCKETS} buckets)` });
    return;
  }

  // The retention read (buildTrend → readSnapshots by entity+ids) is portfolio-wide, NOT per-tenant:
  // `scope` only selects the source, so a scoped principal that passed a projectId/programmeId gate could
  // still name arbitrary FOREIGN ids and read their retained history — an IDOR the gate could not prevent
  // because it bounds the filter params, not the returned bytes. Same reason /history/replay requires
  // portfolio scope. Fail closed: require portfolio (PMO/admin) scope for any trend read.
  if (scopeForReq(req).level !== "all") {
    res.status(403).json({ error: "trend history is portfolio-wide and requires portfolio (PMO/admin) scope" });
    return;
  }

  const scope = { programmeId, projectId };
  const historyEnabled = isFeatureEnabled(selfHostGovernanceId("history"), scope);
  const reason = historyEnabled ? "no retention source configured" : "history domain not enabled for this scope";
  buildTrend(entity, ids, metric, { from, to }, grain, scope, reason)
    .then((series) => res.json(series))
    .catch((err) => {
      req.log.error({ err }, "trend build failed");
      res.status(500).json({ error: "failed to build trend series" });
    });
});

/** GET /history/retention — the cadence config, the resolved cadence for an (optional) scope, and the
 *  DISPOSAL window + legal holds (governance state). `retention` reflects the real window now. */
router.get("/history/retention", requireAnyRole("admin", "pmo"), (req, res) => {
  const config = resolveHistoryRetention();
  const programmeId = (req.query["programmeId"] as string | undefined)?.trim() || null;
  const projectId = (req.query["projectId"] as string | undefined)?.trim() || null;
  res.json({
    config,
    resolved: resolveCadence(config, { programmeId, projectId }),
    retention: config.retentionDays == null ? "infinite" : `${config.retentionDays}d`,
    retentionDays: config.retentionDays ?? null,
    legalHolds: config.legalHolds ?? [],
  });
});

/**
 * PUT /history/retention — persist the cadence config. Admin owns the org default (and may set any
 * scope); a PMO may set programme/project overrides but NOT the org default. Validation (valid
 * cadences) happens in updateSettings; the org-default authority check is here.
 */
router.put("/history/retention", requireAnyRole("admin", "pmo"), async (req, res) => {
  if (!requireArtifactStore(res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const current = resolveHistoryRetention();
  const isAdmin = hasRole(req, "admin");
  if ("orgDefault" in body && !isAdmin) {
    res.status(403).json({ error: "Only an admin can set the org-default cadence." });
    return;
  }
  // The disposal window and legal holds are org-wide governance controls — admin only, like orgDefault.
  if (("retentionDays" in body || "legalHolds" in body) && !isAdmin) {
    res.status(403).json({ error: "Only an admin can set the retention window or legal holds." });
    return;
  }
  const next: Record<string, unknown> = {
    orgDefault: "orgDefault" in body ? body["orgDefault"] : current.orgDefault,
    programme: "programme" in body ? body["programme"] : current.programme,
    project: "project" in body ? body["project"] : current.project,
    ...(("retentionDays" in body ? { retentionDays: body["retentionDays"] } : current.retentionDays != null ? { retentionDays: current.retentionDays } : {})),
    ...(("legalHolds" in body ? { legalHolds: body["legalHolds"] } : current.legalHolds ? { legalHolds: current.legalHolds } : {})),
  };
  let sanitized;
  try {
    sanitized = sanitizeHistoryRetention(next);
  } catch (err) {
    res.status(400).json({ error: err instanceof SettingsValidationError ? err.message : "invalid history-retention config" });
    return;
  }
  // Governing invariant (§0): SHORTENING the disposal window loses audit trail — a relaxation held for a signed
  // sign-off. Lengthening / cadence-only edits apply immediately.
  const guarded = await applyConfigCollectionGuarded(HISTORY_RETENTION_CONFIG_ID, "History retention", sanitized, getSession(req)?.sub ?? "admin");
  if (!guarded.applied) {
    res.status(202).json({ pending: guarded.pending, message: "Shortening the retention window reduces the security posture and needs a signed sign-off before it applies. See /api/approvals/inbox." });
    return;
  }
  captureVersion("history retention updated");
  res.json({ config: resolveHistoryRetention() });
});

/**
 * POST /history/dispose — run disposal: prune retained history older than the configured window
 * (`retentionDays`), skipping legal-held keys. Admin + step-up (it deletes durable data). A no-op when
 * retention is infinite. The delete executes BELOW the seam (via the retention source); the gateway only
 * issues the policy command.
 */
router.post("/history/dispose", requireRole("admin"), requireStepUp, async (req, res) => {
  // The local sealed audit EVIDENCE log has its own retention window (historyRetention.retentionDays); enforce
  // it here too so a single "run disposal" applies it actively — independent of the brokered history source.
  const auditLog = disposeAuditLog();
  const source = retentionSourceFor({});
  if (!source) {
    recordRequestAudit(req, { category: "admin", action: "history.dispose", write: true, result: "success", meta: { auditLog, historySource: false } });
    res.json({ disposed: 0, snapshots: 0, journal: 0, auditLog, note: "no brokered history retention source configured — enforced the audit-log window only" });
    return;
  }
  try {
    const result = await disposeExpired(source, Date.now());
    recordRequestAudit(req, {
      category: "admin", action: "history.dispose", write: true,
      result: "success", meta: { disposed: result.disposed, cutoff: result.cutoff, snapshots: result.snapshots, journal: result.journal, auditLog },
    });
    res.json({ ...result, auditLog });
  } catch (err) {
    if (err instanceof RetentionUnsupportedError) { res.status(501).json({ error: err.message }); return; }
    req.log.error({ err }, "history disposal failed");
    res.status(502).json({ error: "disposal failed at the retention source" });
  }
});

/**
 * POST /history/erase — right-to-erasure / DSAR delete of ALL retained history for one entity id.
 * Admin + step-up. Refused (409) when the entity is under legal hold. The delete executes below the seam.
 */
router.post("/history/erase", requireRole("admin"), requireStepUp, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const entity = typeof body["entity"] === "string" ? body["entity"].trim() : "";
  const id = typeof body["id"] === "string" ? body["id"].trim() : "";
  if (!entity || !id) {
    res.status(400).json({ error: "erase requires a non-empty { entity, id }" });
    return;
  }
  const source = retentionSourceFor({});
  if (!source) {
    res.status(409).json({ error: "no retention source configured — nothing to erase" });
    return;
  }
  try {
    const result = await eraseEntityHistory(source, entity, id);
    recordRequestAudit(req, {
      category: "admin", action: "history.erase", write: true,
      result: "success", meta: { entity, id, snapshots: result.snapshots, journal: result.journal },
    });
    res.json({ entity, id, ...result });
  } catch (err) {
    if (err instanceof LegalHoldError) {
      recordRequestAudit(req, {
        category: "admin", action: "history.erase", write: true,
        result: "error", meta: { entity, id, refused: "legal-hold" },
      });
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof RetentionUnsupportedError) { res.status(501).json({ error: err.message }); return; }
    req.log.error({ err }, "history erasure failed");
    res.status(502).json({ error: "erasure failed at the retention source" });
  }
});

export default router;
