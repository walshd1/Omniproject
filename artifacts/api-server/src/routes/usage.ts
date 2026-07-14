import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import {
  knownVendors, usageSeries, limitStatus, pointCost,
  type SeriesPoint, type UsagePolicy,
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
