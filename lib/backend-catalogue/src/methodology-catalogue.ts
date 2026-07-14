import type { CrossPlaneRef } from "./planes";
import { METHODOLOGIES_DATA } from "./methodologies.generated";

/**
 * METHODOLOGY registry — the PM methodologies OmniProject can shape itself to
 * (Scrum, Kanban, Waterfall, …). Same principle: a neutral manifest (capabilities)
 * separate from its tools (the states / ceremonies / artefacts it brings), linked.
 *
 * A methodology often spans planes — it implies reports (Scrum → burndown) and
 * screens (Kanban → board) — declared via `alsoProvides`.
 */

export type MethodologyKind = "agile" | "hybrid" | "traditional";

export interface MethodologyCapabilities {
  /** Time-boxed iterations (sprints). */
  iterations: boolean;
  /** A pull board with columns. */
  board: boolean;
  /** WIP limits on columns. */
  wipLimits: boolean;
  /** Sequential phases / stage gates. */
  phases: boolean;
  /** Baselines + critical path (plan-driven). */
  baseline: boolean;
  /** How work is estimated. */
  estimation: "story-points" | "hours" | "t-shirt" | "none";
}

export interface MethodologyManifest {
  id: string;
  label: string;
  docsUrl: string;
  kind: MethodologyKind;
  capabilities: MethodologyCapabilities;
  /** Other planes this methodology also lights up. */
  alsoProvides?: CrossPlaneRef[];
  notes?: string;
}

/** A catalogue entry: the manifest + its tools (the workflow states + ceremonies). */
export interface MethodologyDefinition extends MethodologyManifest {
  /** Default workflow states + ceremonies/artefacts it introduces. */
  tools: { states: string[]; ceremonies: string[] };
  /** Display order in the methodology picker. */
  order: number;
}

/** Every shipped methodology, in display order. Authored as JSON under
 *  assets/methodologies/<id>.json and embedded by gen-methodologies (drift-guarded
 *  in CI). Being data is what lets a methodology PACK ship as an importable bundle. */
export const METHODOLOGIES: MethodologyDefinition[] = [...METHODOLOGIES_DATA].sort((a, b) => a.order - b.order);

const byId = new Map(METHODOLOGIES.map((m) => [m.id, m]));

/** One methodology definition by id, or undefined. */
export function getMethodology(id: string): MethodologyDefinition | undefined {
  return byId.get(id);
}

/** All methodology definitions (a defensive copy). */
export function methodologyCatalogue(): MethodologyDefinition[] {
  return METHODOLOGIES.map((m) => ({ ...m }));
}
