/**
 * View registry metadata, sourced from the catalogue's JSON view definitions
 * (@workspace/backend-catalogue/views) so views are DATA, not hand-written code.
 * Components are wired in components/views/registry.tsx; this file adapts the
 * shared definitions to the SPA's ViewMeta shape + helpers the store and switcher
 * use, and carries the methodology TAGS through.
 */
import { VIEWS as CATALOGUE_VIEWS } from "@workspace/backend-catalogue/views";
import type { EngineViewKind, ViewDefinition } from "./view-engine/view-defs";

export type ViewId = "kanban" | "scrum" | "gantt" | "prince2" | "raid" | "list" | "flow";

export type CapabilityDomain =
  | "issues"
  | "scheduling"
  | "resources"
  | "financials"
  | "portfolio"
  | "baseline"
  | "blockers"
  | "history"
  | "raid";

export interface ViewMeta {
  id: ViewId;
  label: string; // full name shown in the switcher
  short: string; // compact label
  group: string; // methodology family
  methodology: string;
  /** Methodology tags — selecting one activates the assets sharing it ("*" = always). */
  methodologies: string[];
  description: string;
  /** The catalogue view kind (board/timeline/stages/register/table). */
  kind: string;
  /** Capability domain this view primarily needs to be fully useful. */
  needs?: CapabilityDomain;
}

/** The shipped views, adapted from the catalogue JSON definitions (display order). */
export const VIEWS: ViewMeta[] = CATALOGUE_VIEWS.map((v) => ({
  id: v.id as ViewId,
  label: v.label,
  short: v.short,
  group: v.group,
  methodology: v.methodology,
  methodologies: v.methodologies,
  description: v.description,
  kind: v.kind,
  ...(v.needs ? { needs: v.needs as CapabilityDomain } : {}),
}));

export const DEFAULT_VIEW: ViewId = "kanban";

const ORDER = VIEWS.map((v) => v.id);

export function isViewId(value: string): value is ViewId {
  return (ORDER as string[]).includes(value);
}

export function nextView(id: ViewId): ViewId {
  const i = ORDER.indexOf(id);
  return ORDER[(i + 1) % ORDER.length]!; // modulo keeps the index in range (VIEWS is non-empty)
}

export function viewMeta(id: ViewId): ViewMeta {
  return VIEWS.find((v) => v.id === id) ?? VIEWS[0]!; // VIEWS is non-empty
}

/** Catalogue view kind → the engine kind a definition declares. Specialized kinds (stages/register)
 *  fall back to their closest engine kind; the `renderer` binding is what actually draws them. */
const KIND_MAP: Record<string, EngineViewKind> = {
  board: "board",
  timeline: "timeline",
  table: "table",
  stages: "board",
  register: "table",
};

/**
 * The shipped methodology views expressed in the unified ViewDefinition model — read-only definitions
 * bound to a registered view renderer (components/views/view-renderers). This is what folds the
 * specialized built-in views (Gantt/PRINCE2/RAID/scrum) into the same "a view is JSON, built-ins
 * read-only" model the generic engine uses; the renderer id lets a definition dispatch to code.
 */
export function methodologyViewDefinitions(): ViewDefinition[] {
  return VIEWS.map((v) => ({
    id: v.id,
    name: v.label,
    entity: "issue",
    kind: KIND_MAP[v.kind] ?? "list",
    renderer: v.id,
    builtin: true,
  }));
}
