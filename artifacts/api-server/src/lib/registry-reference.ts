/**
 * PUBLISHED REFERENCE DESIGNS for the org registry (roadmap 3.5, slice 2). These are annotated, ready-to-
 * submit examples of each buildable kind — a primitive, a screen/form/report/dashboard JSON def — so anyone
 * can learn the canonical shape and author their own registry items. Each design's `example` is a complete
 * registry submission: dropping it into POST /api/registry (or the submit form) works as-is. The examples are
 * held to the SAME sanitiser + def validators the real submit path uses (see registry-reference.test), so a
 * published reference can never drift into an invalid shape. Pure data — no storage or I/O here.
 */
import type { RegistryItemKind } from "@workspace/backend-catalogue";

/** A canonical, copy-pasteable example of one registry item kind, with teaching notes. */
export interface ReferenceDesign {
  /** Stable slug (URL + lookup key). */
  slug: string;
  /** Human title. */
  title: string;
  /** The registry item kind this reference teaches. */
  kind: RegistryItemKind;
  /** One-line "what you'll learn". */
  summary: string;
  /** Field-by-field annotations explaining the shape. */
  notes: string[];
  /** A complete, valid registry submission — paste into POST /api/registry as-is. */
  example: {
    kind: RegistryItemKind;
    name: string;
    publisher: string;
    version: string;
    description: string;
    tags: string[];
    payload: Record<string, unknown>;
  };
}

/**
 * A viz PRIMITIVE — the drop-in `PrimitiveDef` shape the chart library merges (a new chart with no code).
 * Mirrors `components/charts/catalogue.ts::PrimitiveDef`.
 */
const PRIMITIVE_DESIGN: ReferenceDesign = {
  slug: "primitive-viz-chart",
  title: "A visualisation primitive (drop-in chart)",
  kind: "primitive",
  summary: "Add a new chart type as pure JSON — it appears in the builder palette and reports with no code change.",
  notes: [
    "`id` is the stable primitive id (kebab-case). It must be unique across the primitive library.",
    "`category` groups the primitive in the palette (e.g. \"comparison\", \"trend\", \"composition\").",
    "`chartType` names the ChartView spec this draws through, when it is a dispatchable chart.",
    "`params` are the authoring inputs; each has key/label/type/required/description. `type: \"rows\"` takes tabular data; `\"series\"` picks which keys to plot.",
    "Everything is declarative — the renderer already exists; you are only describing which inputs it takes.",
  ],
  example: {
    kind: "primitive",
    name: "Grouped column chart",
    publisher: "Acme Analytics",
    version: "1.0.0",
    description: "A grouped column chart primitive for comparing a few series across categories.",
    tags: ["chart", "comparison"],
    payload: {
      id: "grouped-column",
      label: "Grouped columns",
      category: "comparison",
      description: "Compare several series across a small set of categories.",
      chartType: "bar",
      params: [
        { key: "data", label: "Rows", type: "rows", required: true, description: "One object per category; keys are the plotted fields." },
        { key: "series", label: "Series", type: "series", required: true, description: "Which row keys to plot and their labels." },
        { key: "palette", label: "Palette", type: "palette", required: false, description: "Ordered hex colours; series take them in turn." },
        { key: "height", label: "Height", type: "number", required: false, description: "Pixel height, or a percent string for responsive containers." },
      ],
    },
  },
};

/**
 * A SCREEN JSON def — an org screen override/addition. Mirrors `lib/screen-def.ts::OrgScreenDef`:
 * a string id + label + an array of panels (each a string id + kind, extra config passed through).
 */
const SCREEN_DESIGN: ReferenceDesign = {
  slug: "jsondef-screen",
  title: "A screen definition (JSON def)",
  kind: "jsonDef",
  summary: "Compose a screen from panels — stored org-wide, merged over the built-in catalogue, rendered by the generic builder.",
  notes: [
    "`id` targets a built-in screen to override, or names a new one. `label` is the screen title.",
    "`panels` is an ordered array; each panel needs a unique `id` and a `kind` (a registered panel renderer).",
    "Anything beyond id/kind on a panel (e.g. `source`, `config`, `title`) is passed through untouched to the renderer.",
    "An unknown panel kind degrades to a labelled placeholder rather than breaking the screen — defs are forward-compatible.",
  ],
  example: {
    kind: "jsonDef",
    name: "Delivery health screen",
    publisher: "Acme PMO",
    version: "1.0.0",
    description: "A one-glance delivery-health screen: a KPI strip over a risk register.",
    tags: ["screen", "delivery"],
    payload: {
      id: "delivery-health",
      label: "Delivery health",
      route: "/delivery-health",
      panels: [
        { id: "kpis", kind: "metrics", title: "Health at a glance", source: { metric: "healthStatus" } },
        { id: "risks", kind: "register", title: "Open risks", source: { register: "risk", status: "open" } },
      ],
    },
  },
};

/**
 * A FORM JSON def — an intake form. Mirrors `lib/form-def.ts`: id + label + ≥1 typed field, each mapping to
 * a writable issue field (`mapTo`), exactly one field mapping to `title`, and an `issue` target.
 */
const FORM_DESIGN: ReferenceDesign = {
  slug: "jsondef-form",
  title: "An intake form (JSON def)",
  kind: "form",
  summary: "Author a request/intake form — each submission becomes a work item through the broker.",
  notes: [
    "Each field has key/label/type; `type` is one of text, textarea, number, date, select, checkbox, email, url.",
    "Every field must `mapTo` a writable issue field (title, description, priority, assignee, labels, dueDate, …) — nothing a user types is homeless.",
    "Exactly ONE field must map to `title`. `description` and `labels` may be shared by several fields; every other target is scalar (one field each).",
    "Choice types (select/radio/multiselect) need `options`; add `required: true` to make a field mandatory.",
    "`target.kind` must be `issue`; `target.projectId` is optional on the def (an admin binds it before the form accepts submissions).",
  ],
  example: {
    kind: "form",
    name: "Change request form",
    publisher: "Acme PMO",
    version: "1.0.0",
    description: "A lightweight change-request intake that opens a triaged work item.",
    tags: ["form", "intake", "change"],
    payload: {
      id: "change-request",
      label: "Change request",
      submitLabel: "Raise change",
      fields: [
        { key: "summary", label: "Summary", type: "text", mapTo: "title", required: true, maxLength: 200 },
        { key: "detail", label: "What & why", type: "textarea", mapTo: "description", required: true },
        { key: "priority", label: "Priority", type: "select", mapTo: "priority", options: ["Low", "Medium", "High"], required: true },
        { key: "needBy", label: "Needed by", type: "date", mapTo: "dueDate" },
      ],
      target: { kind: "issue" },
    },
  },
};

/**
 * A REPORT def — a hosted/custom report over broker data. A declarative `query` + a `viz` primitive id to
 * render it through. Kept deliberately small; the report engine reads the payload verbatim.
 */
const REPORT_DESIGN: ReferenceDesign = {
  slug: "report-custom",
  title: "A custom report",
  kind: "report",
  summary: "Define a report as a declarative query plus a visualisation — no code, curated for reuse.",
  notes: [
    "`id`/`label` identify the report; `description` explains what it answers.",
    "`query` is the declarative data request the report engine runs (entity + grouping + measure).",
    "`viz` names a primitive id (see the primitive reference) and maps query columns onto its inputs.",
    "Because it references a primitive rather than embedding a chart, the report inherits any primitive improvements automatically.",
  ],
  example: {
    kind: "report",
    name: "Open work by assignee",
    publisher: "Acme PMO",
    version: "1.0.0",
    description: "Count of open work items grouped by assignee, drawn as a bar chart.",
    tags: ["report", "workload"],
    payload: {
      id: "open-work-by-assignee",
      label: "Open work by assignee",
      description: "How open work is distributed across the team.",
      query: { entity: "issue", filter: { status: "open" }, groupBy: "assignee", measure: "count" },
      viz: { primitive: "bar", map: { data: "$rows", series: [{ key: "count", label: "Open items" }] } },
    },
  },
};

/**
 * A DASHBOARD def — a titled grid of widgets, each a report/metric/primitive reference at a grid position.
 */
const DASHBOARD_DESIGN: ReferenceDesign = {
  slug: "dashboard-grid",
  title: "A dashboard (widget grid)",
  kind: "dashboard",
  summary: "Lay out a dashboard as a grid of widgets — each references a report, metric, or primitive.",
  notes: [
    "`id`/`label` identify the dashboard.",
    "`widgets` is an array; each has a unique `id`, a `kind` (metric/report/chart), a `source` (what it shows) and a grid `layout` (x/y/w/h).",
    "Widgets reference other registry items by id (e.g. a report), so a dashboard composes curated building blocks rather than re-defining them.",
  ],
  example: {
    kind: "dashboard",
    name: "Portfolio overview",
    publisher: "Acme PMO",
    version: "1.0.0",
    description: "A portfolio dashboard: headline metrics over a workload report.",
    tags: ["dashboard", "portfolio"],
    payload: {
      id: "portfolio-overview",
      label: "Portfolio overview",
      widgets: [
        { id: "active-projects", kind: "metric", source: { metric: "activeProjects" }, layout: { x: 0, y: 0, w: 3, h: 1 } },
        { id: "at-risk", kind: "metric", source: { metric: "atRiskProjects" }, layout: { x: 3, y: 0, w: 3, h: 1 } },
        { id: "workload", kind: "report", source: { report: "open-work-by-assignee" }, layout: { x: 0, y: 1, w: 6, h: 3 } },
      ],
    },
  },
};

/** Every published reference design, in a sensible teaching order. */
export const REGISTRY_REFERENCE_DESIGNS: readonly ReferenceDesign[] = [
  PRIMITIVE_DESIGN, SCREEN_DESIGN, FORM_DESIGN, REPORT_DESIGN, DASHBOARD_DESIGN,
];

/** One reference design by slug, or null. */
export function referenceDesign(slug: string): ReferenceDesign | null {
  return REGISTRY_REFERENCE_DESIGNS.find((d) => d.slug === slug) ?? null;
}

/** The reference designs that teach a given registry item kind. */
export function referenceDesignsForKind(kind: RegistryItemKind): ReferenceDesign[] {
  return REGISTRY_REFERENCE_DESIGNS.filter((d) => d.kind === kind);
}
