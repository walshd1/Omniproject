/**
 * View registry metadata, sourced from the catalogue's JSON view definitions
 * (@workspace/backend-catalogue/views) so views are DATA, not hand-written code.
 * Components are wired in components/views/registry.tsx; this file adapts the
 * shared definitions to the SPA's ViewMeta shape + helpers the store and switcher
 * use, and carries the methodology TAGS through.
 */
import { VIEWS as CATALOGUE_VIEWS } from "@workspace/backend-catalogue/views";

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
