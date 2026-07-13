/**
 * Setup catalogue plane — the read-only "what CAN be wired" surface for the Configurator: the
 * backend / broker / output / notification / methodology / view / report / screen / plane catalogues,
 * plus the per-screen layout overrides and the entity-resolution preview. Split out of the setup god
 * router (Stage 3) as one cohesive concern: these are all catalogue reads over the static
 * backend-catalogue package + live capability/governance filters, with no config-mutation lifecycle.
 *
 * Mounted by ./setup.ts under the same base, so every path stays `/setup/...` exactly as before.
 */
import { Router } from "express";
import { getSettings, updateSettings } from "../../lib/settings";
import { resolveSupport } from "../../lib/capabilities";
import { connectedBrokerKinds } from "../../broker/registry";
import { requireRole, requireAnyRole, hasRole } from "../../lib/rbac";
import { captureVersion } from "../../lib/config-store";
import { isFeatureEnabled } from "../../lib/feature-modules";
import {
  backendCatalogue,
  brokerCatalogue,
  outputCatalogue,
  notificationCatalogue,
  notificationRouteCatalogue,
  notificationKindCatalogue,
  methodologyCatalogue,
  methodologyPack,
  allMethodologyTags,
  reportCatalogue,
  screenCatalogue,
  reportsForMethodology,
  screensForMethodology,
  planeCatalogue,
  availableReports,
  availableScreens,
  VIEWS,
  viewsForMethodology,
  dedupeEntities,
  matchCandidates,
  normaliseKey,
} from "@workspace/backend-catalogue";

const router = Router();

/** Governance gate for the report/methodology planes: a PMO `forbid report:x` / `forbid methodology:x`
 *  (or a `require` elsewhere) actually withholds the item from what's offered, not just the admin table.
 *  Resolved at org scope — the surface here is the global catalogue, so org-level mandates apply. */
const reportAllowed = (id: string): boolean => isFeatureEnabled(`report:${id}`);
const methodologyAllowed = (id: string): boolean => isFeatureEnabled(`methodology:${id}`);

// GET /api/setup/backends — full manifest catalogue for the Configurator (docs URLs,
// required env, actions, capabilities). Internal: restricted to PMO/admin, the only
// entity that wires backends. Admin-only backends (raw SQL / Mongo) are additionally
// hidden from a plain PMO caller so they aren't offered a technical integration they
// can't configure (wiring one is admin-gated at generate-workflow / settings regardless
// — this just keeps the wizard honest per authority).
router.get("/setup/backends", requireAnyRole("pmo", "admin"), (req, res) => {
  const isAdmin = hasRole(req, "admin"); // the technical authority
  res.json(backendCatalogue().filter((b) => isAdmin || !b.adminOnly));
});

// GET /api/setup/backends/ids — the OUTER surface: just the ids, for the one
// non-Configurator consumer (Settings' backend-source suggestion dropdown). Same
// admin-only filter, but no manifest detail passed through.
router.get("/setup/backends/ids", (req, res) => {
  const isAdmin = hasRole(req, "admin");
  res.json(backendCatalogue().filter((b) => isAdmin || !b.adminOnly).map((b) => b.id));
});

// The other two integration planes (same shape): which brokers can serve the
// data hop, and which outward interfaces expose data/events. Internal: both are
// Configurator-only reads of live wiring, restricted to PMO/admin.
// Full broker catalogue, or — with ?connected=1 — only the broker KIND(S) actually
// wired to this deployment (the active hop ∪ BROKER_KINDS), the set the capability
// resolver unions over.
router.get("/setup/brokers", requireAnyRole("pmo", "admin"), (req, res) => {
  if (req.query["connected"] !== "1") { res.json(brokerCatalogue()); return; }
  const kinds = new Set(connectedBrokerKinds());
  res.json(brokerCatalogue().filter((b) => kinds.has(b.id)));
});
router.get("/setup/outputs", requireAnyRole("pmo", "admin"), (_req, res) => {
  res.json(outputCatalogue());
});
// Internal: the Configurator's NotificationPicker is its only SPA consumer, so this
// is restricted to PMO/admin like the other wiring-catalogue reads above.
router.get("/setup/notifications", requireAnyRole("pmo", "admin"), (_req, res) => {
  res.json(notificationCatalogue());
});
// The notification ROUTING rules (JSON-defined) — which event kinds dispatch to
// which delivery channels. The generic dispatch decision; delivery is below the seam.
router.get("/setup/notification-routes", (_req, res) => {
  res.json(notificationRouteCatalogue());
});
// The canonical notification KINDS + their severity — the vocabulary routes match on.
router.get("/setup/notification-kinds", (_req, res) => {
  res.json(notificationKindCatalogue());
});
router.get("/setup/methodologies", (_req, res) => {
  res.json(methodologyCatalogue().filter((m) => methodologyAllowed(m.id)));
});
// A methodology PACK — the methodology's definition + every asset carrying its tag
// (views, notification routes, ruleset), as one importable JSON bundle. Admin only:
// it's the portable look-and-feel an operator drops into another deployment's config.
router.get("/setup/methodology-pack/:id", requireRole("admin"), (req, res) => {
  const pack = methodologyPack(String(req.params["id"]));
  if (!pack) { res.status(404).json({ error: "Unknown methodology" }); return; }
  res.setHeader("Content-Disposition", `attachment; filename="methodology-${pack.methodology.id}.json"`);
  res.json(pack);
});
// The board views (JSON-defined) + the cross-plane DERIVED methodology tag list.
// With ?methodology=<tag>, only the views that methodology activates (+ neutral ones).
router.get("/setup/views", (req, res) => {
  const m = req.query["methodology"];
  const views = typeof m === "string" && m ? viewsForMethodology(m) : VIEWS;
  res.json({ views, methodologies: allMethodologyTags() });
});
// The DERIVED methodology PRESET — every asset a methodology activates, across
// planes (views, reports, screens), so a "click kanban" preset surfaces them all.
router.get("/setup/methodology-preset/:id", (req, res) => {
  const id = String(req.params["id"]);
  res.json({ methodology: id, views: viewsForMethodology(id), reports: reportsForMethodology(id).filter((r) => reportAllowed(r.id)), screens: screensForMethodology(id) });
});
// Full catalogue (what OmniProject CAN do), or — with ?available=1 — only the
// entries the CONNECTED backend(s) can actually feed. The hard rule: if none of
// the connected backends support a report/screen, ?available=1 omits it. (`caps`
// is the resolved set — already the union across every connected backend.)
// Internal: the Configurator's report-picker is its only SPA consumer, so this
// is restricted to PMO/admin like the other wiring-catalogue reads above.
router.get("/setup/reports", requireAnyRole("pmo", "admin"), async (req, res) => {
  // Governance gate first (a forbidden report is withheld regardless of backend support), then the
  // backend-capability filter when ?available=1.
  if (req.query["available"] !== "1") { res.json(reportCatalogue().filter((r) => reportAllowed(r.id))); return; }
  const support = await resolveSupport(req).catch(() => null);
  const base = support ? availableReports(support) : reportCatalogue();
  res.json(base.filter((r) => reportAllowed(r.id)));
});
router.get("/setup/screens", async (req, res) => {
  if (req.query["available"] !== "1") { res.json(screenCatalogue()); return; }
  const support = await resolveSupport(req).catch(() => null);
  res.json(support ? availableScreens(support) : screenCatalogue());
});

// Per-screen layout overrides (drag-arranged panel order / spans / hidden). Stored
// in the settings store, so they ride the snapshot/export into the customer's JSON.
// GET is open (the SPA needs it to render); PUT is manager+ (a shared customer view).
router.get("/setup/screens/:id/layout", (req, res) => {
  const layout = getSettings().screenLayouts[String(req.params["id"])] ?? null;
  res.json({ id: req.params["id"], layout });
});

router.put("/setup/screens/:id/layout", requireRole("manager"), (req, res) => {
  const id = String(req.params["id"]);
  const body = (req.body ?? {}) as { order?: unknown; spans?: unknown; hidden?: unknown };
  const layout: { order?: string[]; spans?: Record<string, number>; hidden?: string[] } = {};
  if (Array.isArray(body.order)) layout.order = body.order.filter((x): x is string => typeof x === "string");
  if (body.spans && typeof body.spans === "object") {
    layout.spans = Object.fromEntries(
      Object.entries(body.spans as Record<string, unknown>)
        .filter(([, v]) => typeof v === "number" && (v as number) >= 1 && (v as number) <= 12) as [string, number][],
    );
  }
  if (Array.isArray(body.hidden)) layout.hidden = body.hidden.filter((x): x is string => typeof x === "string");

  const next = { ...getSettings().screenLayouts, [id]: layout };
  updateSettings({ screenLayouts: next });
  captureVersion(`screen layout: ${id}`);
  res.json({ id, layout });
});

// The plane meta-registry — all seven planes + their dev docs.
router.get("/setup/planes", (_req, res) => {
  res.json(planeCatalogue());
});

// Entity-resolution PREVIEW — illustrates reconciling the same real-world entity
// across backends. Runs the stateless helpers over an ILLUSTRATIVE sample (no real
// customer data; nothing is stored). A real deployment feeds records from its
// connected backends and persists any CONFIRMED mapping as JSON in its config dir —
// the truth stays in the backends, never at rest here.
router.get("/setup/entity-resolution/preview", (_req, res) => {
  interface SampleContact { source: string; name: string; email?: string; externalId?: string }
  const sample: SampleContact[] = [
    { source: "jira", name: "Alice Smith", email: "alice@acme.io", externalId: "u-1" },
    { source: "salesforce", name: "Alice Smith", email: "ALICE@acme.io", externalId: "c-9" },
    { source: "erp", name: "alice  smith", email: "alice@acme.io" },
    { source: "jira", name: "Bob Jones", email: "bob@acme.io", externalId: "u-2" },
  ];
  res.json({
    note: "Illustrative sample — no customer data is read or stored. Confirmed mappings would live in the config dir as JSON.",
    deduped: dedupeEntities(sample, (c) => normaliseKey(c.email)),
    candidates: matchCandidates(sample, [
      { name: "email", fn: (c) => normaliseKey(c.email) },
      { name: "name", fn: (c) => normaliseKey(c.name) },
    ]),
  });
});

export default router;
