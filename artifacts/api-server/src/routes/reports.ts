import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { resolveMethodologyComposition } from "../lib/scoped-config";
import { filterComposed } from "@workspace/backend-catalogue";

/**
 * The per-deployment REPORT DEFINITION store. Seeded from the built-in catalogue, then deployment-owned JSON;
 * each entry is a `ReportDefinition` bound to a registered renderer. GET is the RUNTIME read, so it is HARD-
 * GATED by the methodology composition — a curated deployment serves only its composed reports; an uncurated
 * (null) one serves all. This is server-authoritative visibility, not just an SPA filter, so a report curated
 * out can't be pulled via the API. (The composer reads the full bundled catalogue, not this endpoint, so
 * curation still sees everything.) PUT authors the set (pmo+), validated in updateSettings.
 */
const router = Router();

router.get("/reports", (_req, res) => {
  const s = getSettings();
  const reports = filterComposed(resolveMethodologyComposition(), "report", s.reports ?? [], (r) => r.id);
  res.json({ reports });
});

router.use(settingsCollectionRouter({
  path: "/reports",
  settingsKey: "reports",
  versionLabel: "reports updated",
  writeGuards: [requireRole("pmo")],
}));

export default router;
