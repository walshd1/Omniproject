import type { CrossPlaneRef } from "./planes";

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
}

export const METHODOLOGIES: MethodologyDefinition[] = [
  {
    id: "scrum", label: "Scrum", docsUrl: "https://scrumguides.org/", kind: "agile",
    capabilities: { iterations: true, board: true, wipLimits: false, phases: false, baseline: false, estimation: "story-points" },
    tools: { states: ["backlog", "todo", "in_progress", "review", "done"], ceremonies: ["sprint-planning", "daily-standup", "review", "retrospective"] },
    alsoProvides: [{ plane: "reports", note: "burndown / velocity" }, { plane: "screens", note: "sprint board" }],
    notes: "Time-boxed sprints, story points, the four ceremonies.",
  },
  {
    id: "kanban", label: "Kanban", docsUrl: "https://kanban.university/kanban-guide/", kind: "agile",
    capabilities: { iterations: false, board: true, wipLimits: true, phases: false, baseline: false, estimation: "none" },
    tools: { states: ["backlog", "todo", "in_progress", "done"], ceremonies: ["replenishment", "cadence-review"] },
    alsoProvides: [{ plane: "reports", note: "cumulative flow" }, { plane: "screens", note: "WIP-limited board" }],
    notes: "Continuous flow, explicit WIP limits, no fixed iterations.",
  },
  {
    id: "scrumban", label: "Scrumban", docsUrl: "https://www.atlassian.com/agile/project-management/scrumban", kind: "hybrid",
    capabilities: { iterations: true, board: true, wipLimits: true, phases: false, baseline: false, estimation: "story-points" },
    tools: { states: ["backlog", "todo", "in_progress", "review", "done"], ceremonies: ["planning", "daily-standup"] },
    alsoProvides: [{ plane: "reports", note: "cumulative flow + velocity" }],
    notes: "Scrum cadence with Kanban WIP limits.",
  },
  {
    id: "waterfall", label: "Waterfall", docsUrl: "https://en.wikipedia.org/wiki/Waterfall_model", kind: "traditional",
    capabilities: { iterations: false, board: false, wipLimits: false, phases: true, baseline: true, estimation: "hours" },
    tools: { states: ["initiation", "planning", "execution", "monitoring", "closure"], ceremonies: ["stage-gate-review"] },
    alsoProvides: [{ plane: "reports", note: "Gantt + EVM" }, { plane: "screens", note: "schedule / Gantt" }],
    notes: "Sequential phases, baselines, critical path.",
  },
  {
    id: "prince2", label: "PRINCE2", docsUrl: "https://www.prince2.com/uk/prince2-methodology", kind: "traditional",
    capabilities: { iterations: false, board: false, wipLimits: false, phases: true, baseline: true, estimation: "hours" },
    tools: { states: ["starting-up", "initiating", "delivering", "closing"], ceremonies: ["stage-boundary", "exception-report"] },
    alsoProvides: [{ plane: "reports", note: "highlight / exception reports" }],
    notes: "Process-driven stage management with management products.",
  },
  {
    id: "safe", label: "SAFe", docsUrl: "https://scaledagileframework.com/", kind: "hybrid",
    capabilities: { iterations: true, board: true, wipLimits: true, phases: false, baseline: false, estimation: "story-points" },
    tools: { states: ["funnel", "backlog", "in_progress", "review", "done"], ceremonies: ["pi-planning", "sprint-planning", "system-demo", "inspect-and-adapt"] },
    alsoProvides: [{ plane: "reports", note: "PI burnup / portfolio" }, { plane: "screens", note: "programme board" }],
    notes: "Scaled agile across teams (ARTs, PIs); the enterprise-agile option.",
  },
];

/** One methodology definition by id, or undefined. */
export function getMethodology(id: string): MethodologyDefinition | undefined {
  return METHODOLOGIES.find((m) => m.id === id);
}

/** All methodology definitions (a defensive copy). */
export function methodologyCatalogue(): MethodologyDefinition[] {
  return METHODOLOGIES.map((m) => ({ ...m }));
}
