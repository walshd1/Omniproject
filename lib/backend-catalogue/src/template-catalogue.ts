/**
 * PROJECT TEMPLATE catalogue — reusable project blueprints for the "spin up a project from a template"
 * gallery. A template is authored as data (project defaults + seed work items + a methodology tag) and
 * INSTANTIATED through the broker: create the project, then seed its work items. Same "shipped catalogue +
 * org-overridable store" split as forms/screens; the org's usable templates live in the `templates` config
 * collection, these are the shipped starters.
 */
import { matchesMethodology } from "./methodology-match";
import { PROJECT_TEMPLATES_DATA } from "./templates.generated";

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

/** The shipped starter templates — authored as JSON under assets/templates/ and generated into
 *  `templates.generated.ts` (mirrors the presets pipeline, so a preset's `projectTemplate` ref points at data
 *  on both sides). Add a starter by dropping a JSON file, not by editing code. */
export const PROJECT_TEMPLATES: ProjectTemplate[] = PROJECT_TEMPLATES_DATA;

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

/**
 * The EFFECTIVE template set: the shipped default catalogue with the org's stored templates merged over it —
 * an org template with the same id OVERRIDES the built-in, a new id is appended. The "default JSON with
 * org-level override" model (same as screens). Both apps resolve through this so a shipped template is
 * directly usable and an org can customise it.
 */
export function resolveProjectTemplates(org: readonly ProjectTemplate[]): ProjectTemplate[] {
  const overrides = new Map(org.map((t) => [t.id, t]));
  const merged = PROJECT_TEMPLATES.map((b) => overrides.get(b.id) ?? b);
  const builtinIds = new Set(PROJECT_TEMPLATES.map((b) => b.id));
  for (const t of org) if (!builtinIds.has(t.id)) merged.push(t);
  return merged;
}

/** Resolve one template by id from the merged set (org override wins over the shipped default). */
export function resolveProjectTemplate(id: string, org: readonly ProjectTemplate[]): ProjectTemplate | undefined {
  return org.find((t) => t.id === id) ?? getProjectTemplate(id);
}
