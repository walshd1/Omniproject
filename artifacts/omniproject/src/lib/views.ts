/**
 * View registry metadata. A "view" is a methodology lens over the same project
 * issues. Components are wired in components/views/registry.tsx; this file holds
 * just the metadata so the store and switcher can import it without pulling in
 * React components.
 */

export type ViewId = "kanban" | "scrum" | "gantt" | "prince2" | "list";

export interface ViewMeta {
  id: ViewId;
  label: string; // full name shown in the switcher
  short: string; // compact label
  group: string; // methodology family
  methodology: string;
  description: string;
}

export const VIEWS: ViewMeta[] = [
  {
    id: "kanban",
    label: "Kanban Board",
    short: "Kanban",
    group: "Agile",
    methodology: "Kanban / Lean",
    description: "Status columns with WIP limits; drag to move.",
  },
  {
    id: "scrum",
    label: "Scrum Sprint",
    short: "Scrum",
    group: "Agile",
    methodology: "Scrum",
    description: "Active sprint board, backlog, burndown and velocity.",
  },
  {
    id: "gantt",
    label: "Gantt Timeline",
    short: "Gantt",
    group: "Traditional",
    methodology: "Waterfall / Critical Path",
    description: "Time-phased schedule from start / due dates.",
  },
  {
    id: "prince2",
    label: "PRINCE2 Stages",
    short: "PRINCE2",
    group: "Traditional",
    methodology: "PRINCE2",
    description: "Management stages, product status and a highlight report.",
  },
  {
    id: "list",
    label: "List / Table",
    short: "List",
    group: "General",
    methodology: "Methodology-neutral",
    description: "Sortable table of all work items.",
  },
];

export const DEFAULT_VIEW: ViewId = "kanban";

const ORDER = VIEWS.map((v) => v.id);

export function isViewId(value: string): value is ViewId {
  return (ORDER as string[]).includes(value);
}

export function nextView(id: ViewId): ViewId {
  const i = ORDER.indexOf(id);
  return ORDER[(i + 1) % ORDER.length];
}

export function viewMeta(id: ViewId): ViewMeta {
  return VIEWS.find((v) => v.id === id) ?? VIEWS[0];
}
