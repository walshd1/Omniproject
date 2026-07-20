import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { getSession } from "./auth";
import { getNotifyBus } from "../lib/notify-bus";
import crypto from "node:crypto";
import {
  knownVendors, usageSeries, limitStatus, pointCost,
  type SeriesPoint, type UsagePolicy, type LimitStatus,
} from "../lib/usage-metering";

/**
 * External-API USAGE + LIMITS surface.
 *  - GET  /usage            — per-vendor call/token volume (series + current totals for hour/day/month),
 *                             the configured limit's warning status, and cost totals where a cost is set.
 *  - GET  /usage/policies   — the admin-entered per-vendor limits + costs.
 *  - PUT  /usage/policies   — set them (validated in updateSettings; pmo/admin only).
 * Operational cost/volume data, so reads are pmo/admin-gated. Counters live in the shared-state seam
 * (fleet-wide); nothing here reads or exposes a vendor credential.
 */
const router = Router();

const HOUR_POINTS = 48; // last two days, hourly
const DAY_POINTS = 30; // last month, daily
const MONTH_POINTS = 12; // last year, monthly

const head = (s: SeriesPoint[]): { calls: number; tokens: number } => ({ calls: s[0]?.calls ?? 0, tokens: s[0]?.tokens ?? 0 });

router.get("/usage", requireAnyRole("pmo", "admin"), async (_req, res) => {
  const policies = (getSettings().usagePolicies ?? {}) as Record<string, UsagePolicy>;
  const vendors = [...new Set([...(await knownVendors()), ...Object.keys(policies)])].sort();
  const now = Date.now();

  const report = await Promise.all(
    vendors.map(async (vendor) => {
      const policy = policies[vendor] ?? {};
      const [hour, day, month] = await Promise.all([
        usageSeries(vendor, "hour", HOUR_POINTS, now),
        usageSeries(vendor, "day", DAY_POINTS, now),
        usageSeries(vendor, "month", MONTH_POINTS, now),
      ]);
      const totals = { hour: head(hour), day: head(day), month: head(month) };
      const limit = await limitStatus(vendor, policy.limit, now);
      const cost = policy.cost
        ? { currency: policy.cost.currency, day: pointCost(totals.day, policy.cost), month: pointCost(totals.month, policy.cost) }
        : null;
      return { vendor, series: { hour, day, month }, totals, limit, cost, policy };
    }),
  );

  res.json({ generatedAt: new Date(now).toISOString(), vendors: report });
});

/** Every configured vendor's current limit status (only vendors that HAVE a limit configured). */
async function allLimitStatuses(now: number): Promise<{ vendor: string; status: LimitStatus }[]> {
  const policies = (getSettings().usagePolicies ?? {}) as Record<string, UsagePolicy>;
  const out: { vendor: string; status: LimitStatus }[] = [];
  for (const [vendor, policy] of Object.entries(policies)) {
    const status = await limitStatus(vendor, policy.limit, now);
    if (status) out.push({ vendor, status });
  }
  return out;
}

const LEVEL_RANK: Record<LimitStatus["level"], number> = { ok: 0, notice: 1, warn: 2, critical: 3, over: 4 };
const LEVEL_ICON: Record<LimitStatus["level"], string> = { ok: "🟢", notice: "🟡", warn: "🟠", critical: "🔴", over: "⛔" };

/**
 * POST /usage/notify — the shortcut: compute each vendor's current usage-vs-limit and push a
 * notification (targeted to the caller) summarising anything at/over 50/75/90/100%. Returns the same
 * summary so the SPA can show it inline too. No-op-friendly: with no limits configured it reports "all
 * clear". Nothing here reads a credential.
 */
router.post("/usage/notify", requireAnyRole("pmo", "admin"), async (req, res) => {
  const now = Date.now();
  const statuses = await allLimitStatuses(now);
  const flagged = statuses.filter((s) => s.status.level !== "ok").sort((a, b) => LEVEL_RANK[b.status.level] - LEVEL_RANK[a.status.level]);

  const worst = flagged[0]?.status.level ?? "ok";
  const title = flagged.length === 0
    ? "🟢 API usage: all vendors within limits"
    : `${LEVEL_ICON[worst]} API usage: ${flagged.length} vendor${flagged.length > 1 ? "s" : ""} approaching a limit`;
  const body = flagged
    .map((f) => `${LEVEL_ICON[f.status.level]} ${f.vendor}: ${Math.round(f.status.fraction * 100)}% of ${f.status.period} ${f.status.metric} limit (${f.status.used}/${f.status.max})`)
    .join("\n") || "No vendor is over 50% of a configured limit.";

  const session = getSession(req);
  const notification = {
    id: crypto.randomUUID(),
    kind: "usage_limit",
    title,
    body,
    projectId: null,
    issueId: null,
    read: false,
    timestamp: new Date(now).toISOString(),
  };
  // Target the caller only (their sub) — this is a personal "show me my usage" pull, not a broadcast.
  const target = session?.sub ? { sub: session.sub } : undefined;
  await getNotifyBus().publish({ notification, ...(target ? { target } : {}) }).catch(() => {});

  res.json({ worst, flagged: flagged.map((f) => ({ vendor: f.vendor, ...f.status })), notified: !!target });
});

// The admin-entered per-vendor limits + costs (GET open to pmo/admin via the report; the WRITE is gated).
router.use(
  settingsCollectionRouter({
    path: "/usage/policies",
    settingsKey: "usagePolicies",
    responseKey: "usagePolicies",
    versionLabel: "usage policies updated",
    default: {},
    readGuards: [requireAnyRole("pmo", "admin")],
    writeGuards: [requireAnyRole("pmo", "admin")],
  }),
);

export default router;
