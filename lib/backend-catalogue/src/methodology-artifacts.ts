import type { RawScreenDef } from "./screen-def-catalogue";

/**
 * CANONICAL METHODOLOGY ARTIFACTS — one shipped, read-only overview screen per methodology, authored
 * PURELY from the primitive taxonomy: a `screen` (which is a `canvas` + panels) whose every panel is a
 * primitive family that composes down to a root (chart/table/tile/field/… → canvas; register → record).
 * This is the proof that the atoms + trees can express each methodology's canonical surface, and the
 * recipe seeded into the system store (forkable per scope like every other def).
 *
 * Every panel `kind` used here is in {@link PANEL_PRIMITIVE} — i.e. it renders through a catalogued
 * primitive that resolves to a root. No bespoke `component`/`widget`/`view` escape hatches are used, so
 * `methodology-artifacts.test` can assert the WHOLE screen is atom-composable.
 */

/**
 * A screen panel's `kind` → the primitive family it renders through. Only the atom-composable kinds are
 * listed; a kind absent here is a bespoke escape hatch not (yet) expressed as an atom composition.
 * `chart`/`table`/`form`/`geometry` are visuals (→ canvas); `register` is data (→ record); `tile`/`field`
 * are cross-cutting atoms; `metric` is a stat-tile; `text` is a label.
 */
export const PANEL_PRIMITIVE: Record<string, string> = {
  chart: "chart",
  table: "table",
  register: "register",
  tile: "tile",
  metric: "stat-tile",
  field: "field",
  form: "form",
  geometry: "geometry-canvas",
  text: "label",
};

/** Build a methodology's overview screen recipe from atom-composable panels. */
function overview(id: string, label: string, panels: RawScreenDef["panels"]): RawScreenDef {
  return { id: `${id}-overview`, label, methodologies: [id], panels } as RawScreenDef;
}

export const METHODOLOGY_ARTIFACTS: RawScreenDef[] = [
  overview("scrum", "Scrum overview", [
    { id: "sprint-goal", kind: "text", title: "Sprint goal", config: { content: "The sprint goal." } },
    { id: "burndown", kind: "chart", title: "Burndown", config: { chart: { type: "sparkline" } } },
    { id: "velocity", kind: "chart", title: "Velocity", config: { chart: { type: "column" } } },
    { id: "sprint-backlog", kind: "register", title: "Sprint backlog", config: { slot: "sprints" } },
  ]),
  overview("kanban", "Kanban overview", [
    { id: "wip", kind: "metric", title: "WIP", config: { label: "In progress", value: "0" } },
    { id: "board", kind: "table", title: "Board", config: { source: "issues" } },
    { id: "cycle-time", kind: "chart", title: "Cycle time", config: { chart: { type: "sparkline" } } },
  ]),
  overview("scrumban", "Scrumban overview", [
    { id: "board", kind: "table", title: "Board", config: { source: "issues" } },
    { id: "burndown", kind: "chart", title: "Burndown", config: { chart: { type: "sparkline" } } },
  ]),
  overview("waterfall", "Waterfall overview", [
    { id: "schedule", kind: "chart", title: "Schedule", config: { chart: { type: "column" } } },
    { id: "milestones", kind: "register", title: "Milestones", config: { slot: "milestones" } },
  ]),
  overview("prince2", "PRINCE2 overview", [
    { id: "stage", kind: "metric", title: "Current stage", config: { label: "Stage", value: "—" } },
    { id: "stage-gates", kind: "register", title: "Stage gates", config: { slot: "stages" } },
    { id: "raid", kind: "register", title: "RAID", config: { slot: "raid" } },
  ]),
  overview("safe", "SAFe overview", [
    { id: "pi-objectives", kind: "register", title: "PI objectives", config: { slot: "objectives" } },
    { id: "program-board", kind: "table", title: "Program board", config: { source: "issues" } },
    { id: "burnup", kind: "chart", title: "PI burn-up", config: { chart: { type: "sparkline" } } },
  ]),
  overview("grant-tracking", "Grant tracking overview", [
    { id: "grants", kind: "register", title: "Grants", config: { slot: "grants" } },
    { id: "funding", kind: "chart", title: "Funding", config: { chart: { type: "column" } } },
    { id: "deadlines", kind: "metric", title: "Next deadline", config: { label: "Due", value: "—" } },
  ]),
  overview("volunteer-roster", "Volunteer roster overview", [
    { id: "roster", kind: "register", title: "Roster", config: { slot: "roster" } },
    { id: "shifts", kind: "chart", title: "Shifts filled", config: { chart: { type: "column" } } },
  ]),
  overview("fundraising-pipeline", "Fundraising pipeline overview", [
    { id: "pipeline", kind: "table", title: "Pipeline", config: { source: "donations" } },
    { id: "donations", kind: "chart", title: "Donations", config: { chart: { type: "sparkline" } } },
    { id: "target", kind: "metric", title: "Target", config: { label: "Goal", value: "—" } },
  ]),
];

/** The canonical methodology artifact recipes (a fresh array each call). Seeded as `screen` system defs. */
export function methodologyArtifacts(): RawScreenDef[] {
  return METHODOLOGY_ARTIFACTS.map((a) => ({ ...a }));
}
