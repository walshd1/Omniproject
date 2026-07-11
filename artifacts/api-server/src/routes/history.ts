import { Router } from "express";
import { getBroker, contextFromReq, respondBrokerError } from "../broker";
import { isTimeTravelEnabled, getSettings, updateSettings, SettingsValidationError } from "../lib/settings";
import { requireAnyRole, hasRole } from "../lib/rbac";
import { isFeatureEnabled } from "../lib/feature-modules";
import { selfHostGovernanceId } from "../selfhost";
import { buildTrend, resolveCadence, TREND_METRICS, type TrendGrain, type TrendMetric } from "../history";

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
  const from = typeof req.query["from"] === "string" ? (req.query["from"] as string) : undefined;
  const to = typeof req.query["to"] === "string" ? (req.query["to"] as string) : undefined;
  try {
    res.json(await getBroker().replay(contextFromReq(req), { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }));
  } catch (err) {
    req.log.error({ err }, "history replay failed");
    respondBrokerError(res, err);
  }
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
 * with a reason — an honest "history not yet retained", not a 404 or fabricated zeroes.
 */
router.get("/history/trends/:metric", (req, res) => {
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

/** GET /history/retention — the cadence config + the cadence resolved for an (optional) scope. */
router.get("/history/retention", requireAnyRole("admin", "pmo"), (req, res) => {
  const config = getSettings().historyRetention;
  const programmeId = (req.query["programmeId"] as string | undefined)?.trim() || null;
  const projectId = (req.query["projectId"] as string | undefined)?.trim() || null;
  res.json({ config, resolved: resolveCadence(config, { programmeId, projectId }), retention: "infinite" });
});

/**
 * PUT /history/retention — persist the cadence config. Admin owns the org default (and may set any
 * scope); a PMO may set programme/project overrides but NOT the org default. Validation (valid
 * cadences) happens in updateSettings; the org-default authority check is here.
 */
router.put("/history/retention", requireAnyRole("admin", "pmo"), (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const current = getSettings().historyRetention;
  const isAdmin = hasRole(req, "admin");
  if ("orgDefault" in body && !isAdmin) {
    res.status(403).json({ error: "Only an admin can set the org-default cadence." });
    return;
  }
  const next = {
    orgDefault: "orgDefault" in body ? body["orgDefault"] : current.orgDefault,
    programme: "programme" in body ? body["programme"] : current.programme,
    project: "project" in body ? body["project"] : current.project,
  };
  try {
    updateSettings({ historyRetention: next });
  } catch (err) {
    res.status(400).json({ error: err instanceof SettingsValidationError ? err.message : "invalid history-retention config" });
    return;
  }
  res.json({ config: getSettings().historyRetention });
});

export default router;
