/**
 * SCREEN registry — the SPA views OmniProject ships. Same principle: a neutral
 * manifest (capabilities — route, required role, required backend capability,
 * lineage/export) separate from its tools (the widgets on it), linked.
 *
 * Like reports, a screen's `requiresCapability` links it to the BACKEND plane so a
 * screen only appears when the backend can feed it.
 */

export type ScreenKind = "dashboard" | "detail" | "planning" | "report" | "admin";

export interface ScreenCapabilities {
  /** Minimum role to see it (RBAC — the hard gate still enforces this). */
  requiresRole: "viewer" | "contributor" | "manager" | "admin";
  /** Backend capability the screen needs (or null = always). */
  requiresCapability: string | null;
  /** Carries the per-screen data-lineage overlay? */
  dataLineage: boolean;
  /** Offers CSV/JSON export of what it shows? */
  exportable: boolean;
}

export interface ScreenManifest {
  id: string;
  label: string;
  route: string;
  kind: ScreenKind;
  capabilities: ScreenCapabilities;
  notes?: string;
}

export interface ScreenDefinition extends ScreenManifest {
  /** The widgets / panels on the screen. */
  tools: string[];
}

export const SCREENS: ScreenDefinition[] = [
  { id: "home", label: "Home", route: "/", kind: "dashboard", capabilities: { requiresRole: "viewer", requiresCapability: null, dataLineage: true, exportable: true }, tools: ["activity-feed", "my-work", "portfolio-summary"], notes: "Landing dashboard." },
  { id: "programmes", label: "Programmes", route: "/programmes", kind: "dashboard", capabilities: { requiresRole: "viewer", requiresCapability: "portfolio", dataLineage: true, exportable: true }, tools: ["programme-grid", "rag-rollup", "financial-rollup"], notes: "Programme-level portfolio." },
  { id: "programme-detail", label: "Programme detail", route: "/programmes/:id", kind: "detail", capabilities: { requiresRole: "viewer", requiresCapability: "portfolio", dataLineage: true, exportable: true }, tools: ["project-list", "rollup", "financials"], notes: "A single programme." },
  { id: "project-detail", label: "Project detail", route: "/projects/:id", kind: "detail", capabilities: { requiresRole: "viewer", requiresCapability: null, dataLineage: true, exportable: true }, tools: ["task-board", "summary", "members", "financials", "raid"], notes: "A single project + its work items." },
  { id: "gantt", label: "Gantt / schedule", route: "/projects/:id/gantt", kind: "planning", capabilities: { requiresRole: "contributor", requiresCapability: "scheduling", dataLineage: true, exportable: true }, tools: ["gantt-bars", "drag-reschedule", "dependencies", "what-if"], notes: "Schedule + drag-to-reschedule (write-through)." },
  { id: "resource-planning", label: "Resource planning", route: "/resources", kind: "planning", capabilities: { requiresRole: "manager", requiresCapability: "resources", dataLineage: true, exportable: true }, tools: ["capacity-grid", "what-if-allocation", "over-capacity"], notes: "Capacity vs allocation, what-if modelling." },
  { id: "reports", label: "Reports", route: "/reports", kind: "report", capabilities: { requiresRole: "viewer", requiresCapability: null, dataLineage: true, exportable: true }, tools: ["report-picker", "evm", "portfolio-rag", "burndown"], notes: "Renders the REPORTS plane (capability-gated)." },
  { id: "settings", label: "Settings", route: "/settings", kind: "admin", capabilities: { requiresRole: "admin", requiresCapability: null, dataLineage: false, exportable: false }, tools: ["broker-config", "translation-editor", "broker-log", "ruleset"], notes: "Admin configuration." },
];

export function getScreen(id: string): ScreenDefinition | undefined {
  return SCREENS.find((s) => s.id === id);
}

export function screenCatalogue(): ScreenDefinition[] {
  return SCREENS.map((s) => ({ ...s }));
}

/**
 * The HARD capability rule for screens: a screen is AVAILABLE only if at least one
 * connected backend supports the capability it needs (or it needs none). `caps` is
 * the RESOLVED (unioned-across-backends) capability set. Role gating (`requiresRole`)
 * is a SEPARATE, RBAC concern — apply it on top; this gate is purely "can the
 * connected backend(s) feed this screen at all?".
 */
export function availableScreens(caps: Record<string, boolean>): ScreenDefinition[] {
  return screenCatalogue().filter(
    (s) => s.capabilities.requiresCapability === null || caps[s.capabilities.requiresCapability] === true,
  );
}
