import type { ProjectTemplate, TemplateSeedIssue } from "@workspace/backend-catalogue";

/**
 * Project templates — the shape validator + the pure instantiation PLAN (what to create). Instantiating a
 * template = create a project, then seed its work items; this module computes the broker writes but performs
 * none (pure, testable, typed 400s). The route runs the plan through the RBAC-scoped broker.
 */
export class TemplateError extends Error {
  constructor(message: string) { super(message); this.name = "TemplateError"; }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isForbiddenKey = (k: string): boolean => k === "__proto__" || k === "constructor" || k === "prototype";

/** Validate + normalise the stored template list. Pure — throws {@link TemplateError}. */
export function validateTemplates(value: unknown): ProjectTemplate[] {
  if (!Array.isArray(value)) throw new TemplateError("templates must be an array");
  const ids = new Set<string>();
  return value.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = str(o["id"]);
    const label = str(o["label"]);
    if (!id || !label) throw new TemplateError("each template needs an id and a label");
    if (ids.has(id)) throw new TemplateError(`duplicate template id "${id}"`);
    ids.add(id);

    const t: ProjectTemplate = { id, label };
    if (str(o["description"])) t.description = str(o["description"]);
    if (str(o["methodology"])) t.methodology = str(o["methodology"]);
    if (Array.isArray(o["methodologies"])) t.methodologies = (o["methodologies"] as unknown[]).map(str).filter(Boolean);

    if (o["project"] != null) {
      if (typeof o["project"] !== "object" || Array.isArray(o["project"])) throw new TemplateError(`template "${id}" project must be an object`);
      const p = o["project"] as Record<string, unknown>;
      const proj: NonNullable<ProjectTemplate["project"]> = {};
      if (str(p["name"])) proj.name = str(p["name"]);
      if (str(p["description"])) proj.description = str(p["description"]);
      if (str(p["status"])) proj.status = str(p["status"]);
      t.project = proj;
    }

    if (o["seedIssues"] != null) {
      if (!Array.isArray(o["seedIssues"])) throw new TemplateError(`template "${id}" seedIssues must be an array`);
      t.seedIssues = (o["seedIssues"] as unknown[]).map((rawI) => {
        const i = (rawI ?? {}) as Record<string, unknown>;
        const title = str(i["title"]);
        if (!title) throw new TemplateError(`template "${id}" has a seed issue with no title`);
        const issue: TemplateSeedIssue = { title };
        if (str(i["status"])) issue.status = str(i["status"]);
        if (str(i["priority"])) issue.priority = str(i["priority"]);
        if (Array.isArray(i["labels"])) issue.labels = (i["labels"] as unknown[]).map(str).filter((s) => s && !isForbiddenKey(s));
        return issue;
      });
    }
    return t;
  });
}

/** The broker writes an instantiation performs: one project create, then the seed-issue creates. Pure. */
export interface InstantiationPlan {
  project: { name: string; description?: string; status?: string; programmeId?: string };
  seedIssues: TemplateSeedIssue[];
}

/**
 * Plan an instantiation: the project to create (name from the request, else the template default, else the
 * label) plus the seed issues. Pure — the route runs it through the broker.
 */
export function planInstantiation(template: ProjectTemplate, opts: { name?: string; programmeId?: string }): InstantiationPlan {
  const name = str(opts.name) || str(template.project?.name) || template.label;
  const project: InstantiationPlan["project"] = { name };
  if (template.project?.description) project.description = template.project.description;
  if (template.project?.status) project.status = template.project.status;
  if (str(opts.programmeId)) project.programmeId = str(opts.programmeId);
  return { project, seedIssues: template.seedIssues ?? [] };
}
