/**
 * VIEW catalogue — the methodology lenses over a project's work items (Kanban,
 * Scrum, Gantt, PRINCE2, RAID, List). The first of the RENDERABLE planes to move
 * from hand-written TypeScript to JSON: each view is authored as a file under
 * assets/views/<id>.json (validated against assets/schema/view.schema.json) and
 * embedded by scripts/src/gen-views.ts.
 *
 * A view carries a `methodologies` TAG list. A methodology is not a plane — it is
 * the DERIVED set of assets sharing a tag (the same way a programme is derived
 * from project membership): selecting one activates the views (and, in time,
 * reports/screens/rulesets) tagged with it. "*" means neutral / always shown.
 */
import { matchesMethodology } from "./methodology-match";
import { VIEWS_DATA } from "./views.generated";

export type ViewKind = "board" | "timeline" | "stages" | "register" | "table";

export interface ViewDefinition {
  id: string;
  label: string;
  short: string;
  /** Methodology family shown as a switcher heading. */
  group: string;
  /** Human display name of the methodology. */
  methodology: string;
  /** Methodology tags — selecting one activates the matching assets ("*" = always). */
  methodologies: string[];
  kind: ViewKind;
  /** Backend capability domain this view needs to be fully useful (or undefined = always). */
  needs?: string;
  description: string;
  /** Display order in the switcher. */
  order: number;
}

/** Every shipped view definition, in display order. */
export const VIEWS: ViewDefinition[] = [...VIEWS_DATA].sort((a, b) => a.order - b.order);

/** One view by id, or undefined. */
export function getView(id: string): ViewDefinition | undefined {
  return VIEWS.find((v) => v.id === id);
}

/** Views that apply to a methodology — those tagged with it, plus the neutral ("*") ones. */
export function viewsForMethodology(methodology: string): ViewDefinition[] {
  return VIEWS.filter((v) => matchesMethodology(v.methodologies, methodology));
}

/** The distinct, non-neutral methodologies referenced by any view (the picker list, DERIVED). */
export function methodologyTags(): string[] {
  const out = new Set<string>();
  for (const v of VIEWS) for (const m of v.methodologies) if (m !== "*") out.add(m);
  return [...out].sort();
}
