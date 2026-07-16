/**
 * PROJECT TEMPLATE catalogue — reusable project blueprints for the "spin up a project from a template"
 * gallery. A template is authored as data (project defaults + seed work items + a methodology tag) and
 * INSTANTIATED through the broker: create the project, then seed its work items. Same "shipped catalogue +
 * org-overridable store" split as forms/screens; the org's usable templates live in the `templates` config
 * collection, these are the shipped starters.
 */
import { matchesMethodology } from "./methodology-match";

/** A work item to seed into a freshly-instantiated project. */
export interface TemplateSeedIssue {
  title: string;
  status?: string;
  priority?: string;
  labels?: string[];
}

/** A reusable project blueprint. */
export interface ProjectTemplate {
  id: string;
  label: string;
  description?: string;
  /** Methodology this template sets up for (tag; drives the gallery + composition hint). */
  methodology?: string;
  /** Defaults for the created project (name is usually overridden at instantiate time). */
  project?: { name?: string; description?: string; status?: string };
  /** Work items seeded into the new project, in order. */
  seedIssues?: TemplateSeedIssue[];
  /** Gallery tags (like forms/screens). "*"/omitted = neutral. */
  methodologies?: string[];
}

/** The shipped starter templates. */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "scrum-starter",
    label: "Scrum project",
    description: "A sprint-ready backlog with the usual ceremonies as work items.",
    methodology: "scrum",
    methodologies: ["scrum", "agile"],
    project: { description: "Scrum project created from a template." },
    seedIssues: [
      { title: "Sprint 0: set up the board & backlog", status: "todo", priority: "high", labels: ["setup"] },
      { title: "Define the Definition of Done", status: "todo", priority: "medium" },
      { title: "First sprint planning", status: "todo", priority: "medium" },
      { title: "Backlog: sample user story", status: "backlog", priority: "low", labels: ["story"] },
    ],
  },
  {
    id: "prince2-starter",
    label: "PRINCE2 project",
    description: "A stage-gated project shell with the PRINCE2 management products as work items.",
    methodology: "prince2",
    methodologies: ["prince2", "governance"],
    project: { description: "PRINCE2 project created from a template." },
    seedIssues: [
      { title: "Project Brief", status: "todo", priority: "high", labels: ["initiation"] },
      { title: "Business Case", status: "todo", priority: "high", labels: ["initiation"] },
      { title: "Stage 1 plan", status: "todo", priority: "medium" },
      { title: "Risk register set-up", status: "todo", priority: "medium", labels: ["raid"] },
    ],
  },
];

const byId = new Map(PROJECT_TEMPLATES.map((t) => [t.id, t]));
/** One template by id, or undefined. */
export function getProjectTemplate(id: string): ProjectTemplate | undefined {
  return byId.get(id);
}
/** All templates (a defensive copy). */
export function projectTemplateCatalogue(): ProjectTemplate[] {
  return PROJECT_TEMPLATES.map((t) => ({ ...t }));
}
/** Templates tagged for a methodology (neutral tags always match). */
export function projectTemplatesForMethodology(methodology: string): ProjectTemplate[] {
  return PROJECT_TEMPLATES.filter((t) => matchesMethodology(t.methodologies, methodology));
}
