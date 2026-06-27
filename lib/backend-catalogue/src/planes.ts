/**
 * The PLANES meta-registry — the seven integration planes OmniProject models, all
 * on the same principle (neutral manifest + capabilities SEPARATE from tools,
 * linked). Each plane has dev docs and a verifier for developer-written entries
 * (see ./plane-verifier.ts).
 *
 * Cross-plane: an entry may offer things across MORE THAN ONE plane (e.g. an n8n
 * broker also delivers notifications). Entries declare that with `alsoProvides`.
 */

export type PlaneId =
  | "backends"
  | "brokers"
  | "outputs"
  | "notifications"
  | "methodologies"
  | "reports"
  | "screens";

/** A cross-plane reference: "this entry also offers something on plane X". */
export interface CrossPlaneRef {
  plane: PlaneId;
  note?: string;
}

export interface PlaneDescriptor {
  id: PlaneId;
  label: string;
  description: string;
  /** The registry accessor name (for discoverability). */
  registry: string;
  /** Dev docs — how to build an entry for this plane. */
  devDocs: string;
  /**
   * Is this a VENDOR plane? Entries on a vendor plane represent a specific
   * vendor/product (Jira, n8n, Slack, Power BI) whose specifics sit BELOW the
   * seam; entries on a NEUTRAL plane are vendor-agnostic concepts (Scrum, Gantt, a
   * screen). The architectural invariant: **a vendor is only ever a backend,
   * broker, notification or output — never a methodology/report/screen, and never
   * its own plane.** Encoded here so it's machine-checked (see plane-verifier /
   * the planes test), not just a convention.
   */
  vendor: boolean;
}

export const PLANES: PlaneDescriptor[] = [
  { id: "backends", label: "Backends", description: "Systems of record (Jira, SAP, Salesforce, …).", registry: "backendCatalogue", devDocs: "docs/dev/PLANE-BACKENDS.md", vendor: true },
  { id: "brokers", label: "Brokers", description: "The automation/translation hop (n8n, Make, serverless, …).", registry: "brokerCatalogue", devDocs: "docs/dev/PLANE-BROKERS.md", vendor: true },
  { id: "outputs", label: "Outputs", description: "Outward read/event interfaces (MCP, OData, BI, metrics, exports).", registry: "outputCatalogue", devDocs: "docs/dev/PLANE-OUTPUTS.md", vendor: true },
  { id: "notifications", label: "Notifications", description: "Channels alerts are delivered to (Slack, Teams, …).", registry: "notificationCatalogue", devDocs: "docs/dev/PLANE-NOTIFICATIONS.md", vendor: true },
  { id: "methodologies", label: "Methodologies", description: "PM methodologies (Scrum, Kanban, Waterfall, SAFe, …).", registry: "methodologyCatalogue", devDocs: "docs/dev/PLANE-METHODOLOGIES.md", vendor: false },
  { id: "reports", label: "Reports", description: "Report / visualisation types (Gantt, burndown, EVM, …).", registry: "reportCatalogue", devDocs: "docs/dev/PLANE-REPORTS.md", vendor: false },
  { id: "screens", label: "Screens", description: "SPA views (Home, Programmes, Gantt, Reports, …).", registry: "screenCatalogue", devDocs: "docs/dev/PLANE-SCREENS.md", vendor: false },
];

/** The planes a specific VENDOR/product can be an entry on — never anywhere else. */
export const VENDOR_PLANES: readonly PlaneId[] = PLANES.filter((p) => p.vendor).map((p) => p.id);

/** Look up a single plane descriptor by its id. */
export function getPlane(id: string): PlaneDescriptor | undefined {
  return PLANES.find((p) => p.id === id);
}

/** All plane descriptors (a defensive copy). */
export function planeCatalogue(): PlaneDescriptor[] {
  return PLANES.map((p) => ({ ...p }));
}
