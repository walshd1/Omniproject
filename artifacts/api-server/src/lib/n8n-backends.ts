/**
 * Backend manifests — the data that drives n8n workflow generation.
 *
 * OmniProject stays decoupled: it never talks to a backend directly. Instead a
 * manifest declares, per contract action, how a given backend's REST API is
 * called (method / URL / body) and how the result normalizes to the
 * OmniProject schema. The generator (n8n-generator.ts) turns a manifest into a
 * complete, importable n8n workflow.
 *
 * URLs are n8n expressions. They reference:
 *   - `$env.<NAME>`               instance/base URL + secrets
 *   - `$json.body.payload.*`      the action payload (projectId, issueId, …)
 *   - `$json.body.payload.userContext.token`  the active user's bearer (impersonation)
 *
 * These are *reference* mappings — every team should verify paths/fields against
 * their own backend version. They are intentionally easy to tweak post-import.
 */

export type ContractAction =
  | "list_projects"
  | "list_issues"
  | "create_issue"
  | "update_issue"
  | "delete_issue"
  | "get_capabilities";

export interface ActionMapping {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** n8n expression for the request URL. */
  url: string;
  /** n8n expression producing the JSON request body (writes only). */
  body?: string;
  note?: string;
}

export interface BackendManifest {
  id: string;
  label: string;
  docsUrl: string;
  /** n8n expression for the Authorization header value. */
  authHeader: string;
  /** Env vars the operator must set in n8n for this backend. */
  requiredEnv: string[];
  /** Default capability flags this backend can populate out of the box. */
  capabilities: Record<string, boolean>;
  actions: Partial<Record<ContractAction, ActionMapping>>;
  notes?: string;
}

// Per-user impersonation: the active user's OIDC token, forwarded by the gateway.
const USER_BEARER = "=Bearer {{ $json.body.payload.userContext.token }}";

const CAPS_CORE = {
  issues: true,
  scheduling: true,
  portfolio: false,
  resources: false,
  financials: false,
  baseline: false,
  blockers: false,
  history: false,
  raid: false,
};

export const BACKENDS: BackendManifest[] = [
  {
    id: "openproject",
    label: "OpenProject",
    docsUrl: "https://www.openproject.org/docs/api/",
    authHeader: USER_BEARER,
    requiredEnv: ["OPENPROJECT_INSTANCE_URL"],
    capabilities: { ...CAPS_CORE, portfolio: true, baseline: true, history: true },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.OPENPROJECT_INSTANCE_URL }}/api/v3/projects" },
      list_issues: { method: "GET", url: "={{ $env.OPENPROJECT_INSTANCE_URL }}/api/v3/projects/{{ $json.body.payload.projectId }}/work_packages" },
      create_issue: { method: "POST", url: "={{ $env.OPENPROJECT_INSTANCE_URL }}/api/v3/work_packages", body: "={{ JSON.stringify({ subject: $json.body.payload.title, description: { raw: $json.body.payload.description }, _links: { project: { href: '/api/v3/projects/' + $json.body.payload.projectId } } }) }}" },
      update_issue: { method: "PATCH", url: "={{ $env.OPENPROJECT_INSTANCE_URL }}/api/v3/work_packages/{{ $json.body.payload.issueId }}", body: "={{ JSON.stringify({ lockVersion: $json.body.payload.expectedVersion, subject: $json.body.payload.title }) }}", note: "OpenProject enforces optimistic concurrency via lockVersion — pass expectedVersion through as lockVersion." },
      delete_issue: { method: "DELETE", url: "={{ $env.OPENPROJECT_INSTANCE_URL }}/api/v3/work_packages/{{ $json.body.payload.issueId }}" },
    },
    notes: "OpenProject work packages map to OmniProject issues. lockVersion ↔ version gives real optimistic concurrency. Baselines + journals give history/baseline.",
  },
  {
    id: "plane",
    label: "Plane",
    docsUrl: "https://docs.plane.so/api-reference/introduction",
    authHeader: "=Bearer {{ $json.body.payload.userContext.token }}",
    requiredEnv: ["PLANE_INSTANCE_URL", "PLANE_WORKSPACE_SLUG"],
    capabilities: { ...CAPS_CORE },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.PLANE_INSTANCE_URL }}/api/v1/workspaces/{{ $env.PLANE_WORKSPACE_SLUG }}/projects/" },
      list_issues: { method: "GET", url: "={{ $env.PLANE_INSTANCE_URL }}/api/v1/workspaces/{{ $env.PLANE_WORKSPACE_SLUG }}/projects/{{ $json.body.payload.projectId }}/issues/" },
      create_issue: { method: "POST", url: "={{ $env.PLANE_INSTANCE_URL }}/api/v1/workspaces/{{ $env.PLANE_WORKSPACE_SLUG }}/projects/{{ $json.body.payload.projectId }}/issues/", body: "={{ JSON.stringify({ name: $json.body.payload.title, description_html: $json.body.payload.description }) }}" },
      update_issue: { method: "PATCH", url: "={{ $env.PLANE_INSTANCE_URL }}/api/v1/workspaces/{{ $env.PLANE_WORKSPACE_SLUG }}/projects/{{ $json.body.payload.projectId }}/issues/{{ $json.body.payload.issueId }}/", body: "={{ JSON.stringify({ name: $json.body.payload.title }) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.PLANE_INSTANCE_URL }}/api/v1/workspaces/{{ $env.PLANE_WORKSPACE_SLUG }}/projects/{{ $json.body.payload.projectId }}/issues/{{ $json.body.payload.issueId }}/" },
    },
    notes: "Plane uses an X-API-Key header in many deployments; swap the Authorization header for X-API-Key if you use a service token instead of per-user OIDC.",
  },
  {
    id: "jira",
    label: "Jira (Cloud)",
    docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
    authHeader: "=Basic {{ $env.JIRA_BASIC_AUTH }}",
    requiredEnv: ["JIRA_INSTANCE_URL", "JIRA_BASIC_AUTH"],
    capabilities: { ...CAPS_CORE, blockers: true },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.JIRA_INSTANCE_URL }}/rest/api/3/project/search" },
      list_issues: { method: "GET", url: "={{ $env.JIRA_INSTANCE_URL }}/rest/api/3/search?jql=project={{ $json.body.payload.projectId }}" },
      create_issue: { method: "POST", url: "={{ $env.JIRA_INSTANCE_URL }}/rest/api/3/issue", body: "={{ JSON.stringify({ fields: { project: { key: $json.body.payload.projectId }, summary: $json.body.payload.title, issuetype: { name: 'Task' } } }) }}" },
      update_issue: { method: "PUT", url: "={{ $env.JIRA_INSTANCE_URL }}/rest/api/3/issue/{{ $json.body.payload.issueId }}", body: "={{ JSON.stringify({ fields: { summary: $json.body.payload.title } }) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.JIRA_INSTANCE_URL }}/rest/api/3/issue/{{ $json.body.payload.issueId }}" },
    },
    notes: "JIRA_BASIC_AUTH = base64('email:api_token'). Sprints/story points come from Agile fields (board API + customfield_*); attach sprint:/sp: labels in the Normalize node.",
  },
  {
    id: "github",
    label: "GitHub Issues",
    docsUrl: "https://docs.github.com/en/rest/issues",
    authHeader: "=Bearer {{ $json.body.payload.userContext.token }}",
    requiredEnv: ["GITHUB_OWNER"],
    capabilities: { ...CAPS_CORE, scheduling: false },
    actions: {
      list_projects: { method: "GET", url: "=https://api.github.com/orgs/{{ $env.GITHUB_OWNER }}/repos", note: "GitHub has no 'projects' primitive in the issues API — repos are mapped to projects here." },
      list_issues: { method: "GET", url: "=https://api.github.com/repos/{{ $env.GITHUB_OWNER }}/{{ $json.body.payload.projectId }}/issues?state=all" },
      create_issue: { method: "POST", url: "=https://api.github.com/repos/{{ $env.GITHUB_OWNER }}/{{ $json.body.payload.projectId }}/issues", body: "={{ JSON.stringify({ title: $json.body.payload.title, body: $json.body.payload.description, labels: $json.body.payload.labels }) }}" },
      update_issue: { method: "PATCH", url: "=https://api.github.com/repos/{{ $env.GITHUB_OWNER }}/{{ $json.body.payload.projectId }}/issues/{{ $json.body.payload.issueId }}", body: "={{ JSON.stringify({ title: $json.body.payload.title, state: $json.body.payload.status === 'done' ? 'closed' : 'open' }) }}" },
      delete_issue: { method: "PATCH", url: "=https://api.github.com/repos/{{ $env.GITHUB_OWNER }}/{{ $json.body.payload.projectId }}/issues/{{ $json.body.payload.issueId }}", body: "={{ JSON.stringify({ state: 'closed' }) }}", note: "GitHub issues can't be deleted via REST — closing is the closest mapping." },
    },
    notes: "projectId = repository name. Map issue.state (open/closed) ↔ status; GitHub has no native start/due dates (scheduling off).",
  },
  {
    id: "gitlab",
    label: "GitLab Issues",
    docsUrl: "https://docs.gitlab.com/ee/api/issues.html",
    authHeader: "=Bearer {{ $json.body.payload.userContext.token }}",
    requiredEnv: ["GITLAB_INSTANCE_URL"],
    capabilities: { ...CAPS_CORE },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.GITLAB_INSTANCE_URL }}/api/v4/projects?membership=true" },
      list_issues: { method: "GET", url: "={{ $env.GITLAB_INSTANCE_URL }}/api/v4/projects/{{ $json.body.payload.projectId }}/issues" },
      create_issue: { method: "POST", url: "={{ $env.GITLAB_INSTANCE_URL }}/api/v4/projects/{{ $json.body.payload.projectId }}/issues", body: "={{ JSON.stringify({ title: $json.body.payload.title, description: $json.body.payload.description, due_date: $json.body.payload.dueDate }) }}" },
      update_issue: { method: "PUT", url: "={{ $env.GITLAB_INSTANCE_URL }}/api/v4/projects/{{ $json.body.payload.projectId }}/issues/{{ $json.body.payload.issueId }}", body: "={{ JSON.stringify({ title: $json.body.payload.title, state_event: $json.body.payload.status === 'done' ? 'close' : 'reopen' }) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.GITLAB_INSTANCE_URL }}/api/v4/projects/{{ $json.body.payload.projectId }}/issues/{{ $json.body.payload.issueId }}" },
    },
    notes: "projectId = GitLab numeric project id. iid vs id: writes use the issue iid within the project.",
  },
  {
    id: "azure-devops",
    label: "Azure DevOps (Boards)",
    docsUrl: "https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/",
    authHeader: "=Basic {{ $env.AZDO_BASIC_AUTH }}",
    requiredEnv: ["AZDO_ORG_URL", "AZDO_BASIC_AUTH"],
    capabilities: { ...CAPS_CORE, scheduling: true, blockers: true },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.AZDO_ORG_URL }}/_apis/projects?api-version=7.1" },
      list_issues: { method: "POST", url: "={{ $env.AZDO_ORG_URL }}/{{ $json.body.payload.projectId }}/_apis/wit/wiql?api-version=7.1", body: "={{ JSON.stringify({ query: \"SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = @project\" }) }}", note: "WIQL returns work-item ids; a follow-up batch GET hydrates fields. Add a second HTTP node for /_apis/wit/workitems?ids=..." },
      create_issue: { method: "POST", url: "={{ $env.AZDO_ORG_URL }}/{{ $json.body.payload.projectId }}/_apis/wit/workitems/$Task?api-version=7.1", body: "={{ JSON.stringify([{ op: 'add', path: '/fields/System.Title', value: $json.body.payload.title }]) }}", note: "Content-Type must be application/json-patch+json for work-item create/update." },
      update_issue: { method: "PATCH", url: "={{ $env.AZDO_ORG_URL }}/_apis/wit/workitems/{{ $json.body.payload.issueId }}?api-version=7.1", body: "={{ JSON.stringify([{ op: 'add', path: '/fields/System.Title', value: $json.body.payload.title }]) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.AZDO_ORG_URL }}/_apis/wit/workitems/{{ $json.body.payload.issueId }}?api-version=7.1" },
    },
    notes: "AZDO_BASIC_AUTH = base64(':PAT'). Work-item writes need the json-patch+json content type — set it on the HTTP node after import.",
  },
];

export function getBackend(id: string): BackendManifest | undefined {
  return BACKENDS.find((b) => b.id === id);
}

/** Lightweight catalogue for the wizard UI (no n8n expressions). */
export function backendCatalogue() {
  return BACKENDS.map((b) => ({
    id: b.id,
    label: b.label,
    docsUrl: b.docsUrl,
    requiredEnv: b.requiredEnv,
    actions: Object.keys(b.actions),
    capabilities: b.capabilities,
    notes: b.notes,
  }));
}
