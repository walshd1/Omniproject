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

/**
 * An action is implemented either as a raw HTTP call or — preferably, where n8n
 * ships a maintained node for the tool — as that **native n8n node**, so the
 * integration/auth burden lives in n8n rather than in our own mappings.
 */
export interface ActionMapping {
  /** "http" (default) or "n8nNode". */
  kind?: "http" | "n8nNode";

  // ── http transport ──
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** n8n expression for the request URL. */
  url?: string;
  /** n8n expression producing the JSON request body (writes only). */
  body?: string;
  /** Use an n8n-managed predefined credential (OAuth etc.) instead of the
   *  per-user bearer — e.g. "microsoftDynamicsOAuth2Api". */
  credentialType?: string;

  // ── n8nNode transport ──
  /** Node type, e.g. "n8n-nodes-base.asana". */
  node?: string;
  typeVersion?: number;
  /** Node parameters (resource/operation/etc.). */
  parameters?: Record<string, unknown>;

  note?: string;
}

export interface BackendManifest {
  id: string;
  label: string;
  docsUrl: string;
  /** How this backend authenticates / is wired (for the wizard UI). */
  via: string;
  /** n8n expression for the Authorization header value (http per-user transport). */
  authHeader: string;
  /** Env vars the operator must set in n8n for this backend. */
  requiredEnv: string[];
  /** n8n credential type to attach to native nodes / managed-auth HTTP nodes. */
  credentialType?: string;
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
    via: "HTTP + per-user OIDC token",
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
    via: "HTTP + per-user token / X-API-Key",
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
    via: "HTTP + Basic (email:token)",
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
    via: "HTTP + per-user token",
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
    via: "HTTP + per-user token",
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
    via: "HTTP + Basic (PAT)",
    authHeader: "=Basic {{ $env.AZDO_BASIC_AUTH }}",
    requiredEnv: ["AZDO_ORG_URL", "AZDO_BASIC_AUTH"],
    capabilities: { ...CAPS_CORE, blockers: true },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.AZDO_ORG_URL }}/_apis/projects?api-version=7.1" },
      list_issues: { method: "POST", url: "={{ $env.AZDO_ORG_URL }}/{{ $json.body.payload.projectId }}/_apis/wit/wiql?api-version=7.1", body: "={{ JSON.stringify({ query: \"SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = @project\" }) }}", note: "WIQL returns work-item ids; a follow-up batch GET hydrates fields. Add a second HTTP node for /_apis/wit/workitems?ids=..." },
      create_issue: { method: "POST", url: "={{ $env.AZDO_ORG_URL }}/{{ $json.body.payload.projectId }}/_apis/wit/workitems/$Task?api-version=7.1", body: "={{ JSON.stringify([{ op: 'add', path: '/fields/System.Title', value: $json.body.payload.title }]) }}", note: "Content-Type must be application/json-patch+json for work-item create/update." },
      update_issue: { method: "PATCH", url: "={{ $env.AZDO_ORG_URL }}/_apis/wit/workitems/{{ $json.body.payload.issueId }}?api-version=7.1", body: "={{ JSON.stringify([{ op: 'add', path: '/fields/System.Title', value: $json.body.payload.title }]) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.AZDO_ORG_URL }}/_apis/wit/workitems/{{ $json.body.payload.issueId }}?api-version=7.1" },
    },
    notes: "AZDO_BASIC_AUTH = base64(':PAT'). Work-item writes need the json-patch+json content type — set it on the HTTP node after import.",
  },

  // ── Native n8n nodes (integration risk lives in n8n, not here) ──────────────
  {
    id: "asana",
    label: "Asana",
    docsUrl: "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.asana/",
    via: "Native n8n node (asanaApi credential)",
    authHeader: "",
    requiredEnv: ["ASANA_WORKSPACE_ID"],
    credentialType: "asanaApi",
    capabilities: { ...CAPS_CORE },
    actions: {
      list_projects: { kind: "n8nNode", node: "n8n-nodes-base.asana", typeVersion: 1, parameters: { resource: "project", operation: "getAll", returnAll: true, workspace: "={{ $env.ASANA_WORKSPACE_ID }}" } },
      list_issues: { kind: "n8nNode", node: "n8n-nodes-base.asana", typeVersion: 1, parameters: { resource: "task", operation: "getAll", returnAll: true, filters: { project: "={{ $json.body.payload.projectId }}" } } },
      create_issue: { kind: "n8nNode", node: "n8n-nodes-base.asana", typeVersion: 1, parameters: { resource: "task", operation: "create", name: "={{ $json.body.payload.title }}", otherProperties: { projects: "={{ [$json.body.payload.projectId] }}", notes: "={{ $json.body.payload.description }}" } } },
      update_issue: { kind: "n8nNode", node: "n8n-nodes-base.asana", typeVersion: 1, parameters: { resource: "task", operation: "update", id: "={{ $json.body.payload.issueId }}", otherProperties: { name: "={{ $json.body.payload.title }}" } } },
      delete_issue: { kind: "n8nNode", node: "n8n-nodes-base.asana", typeVersion: 1, parameters: { resource: "task", operation: "delete", id: "={{ $json.body.payload.issueId }}" } },
    },
    notes: "Uses the maintained Asana node + an Asana credential in n8n. projectId = Asana project gid, issueId = task gid. Confirm field names in the node after import.",
  },
  {
    id: "monday",
    label: "Monday.com",
    docsUrl: "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.mondaycom/",
    via: "Native n8n node (mondayComApi credential)",
    authHeader: "",
    requiredEnv: [],
    credentialType: "mondayComApi",
    capabilities: { ...CAPS_CORE },
    actions: {
      list_projects: { kind: "n8nNode", node: "n8n-nodes-base.mondayCom", typeVersion: 1, parameters: { resource: "board", operation: "getAll", returnAll: true } },
      list_issues: { kind: "n8nNode", node: "n8n-nodes-base.mondayCom", typeVersion: 1, parameters: { resource: "boardItem", operation: "getAll", boardId: "={{ $json.body.payload.projectId }}", returnAll: true } },
      create_issue: { kind: "n8nNode", node: "n8n-nodes-base.mondayCom", typeVersion: 1, parameters: { resource: "boardItem", operation: "create", boardId: "={{ $json.body.payload.projectId }}", name: "={{ $json.body.payload.title }}" } },
      update_issue: { kind: "n8nNode", node: "n8n-nodes-base.mondayCom", typeVersion: 1, parameters: { resource: "boardItem", operation: "changeColumnValue", boardId: "={{ $json.body.payload.projectId }}", itemId: "={{ $json.body.payload.issueId }}" }, note: "Monday updates set a specific column value — map status/name to your board columns after import." },
      delete_issue: { kind: "n8nNode", node: "n8n-nodes-base.mondayCom", typeVersion: 1, parameters: { resource: "boardItem", operation: "delete", itemId: "={{ $json.body.payload.issueId }}" } },
    },
    notes: "projectId = board id, issueId = item id. Boards map to projects, items to issues. Column mapping is board-specific — finish it in the node.",
  },
  {
    id: "servicenow",
    label: "ServiceNow (PPM)",
    docsUrl: "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.servicenow/",
    via: "Native n8n node (serviceNowBasicApi credential)",
    authHeader: "",
    requiredEnv: [],
    credentialType: "serviceNowBasicApi",
    capabilities: { ...CAPS_CORE, portfolio: true },
    actions: {
      list_projects: { kind: "n8nNode", node: "n8n-nodes-base.serviceNow", typeVersion: 1, parameters: { resource: "tableRecord", operation: "getAll", tableName: "pm_project", returnAll: true } },
      list_issues: { kind: "n8nNode", node: "n8n-nodes-base.serviceNow", typeVersion: 1, parameters: { resource: "tableRecord", operation: "getAll", tableName: "pm_project_task", returnAll: true, filters: { query: "=parent={{ $json.body.payload.projectId }}" } } },
      create_issue: { kind: "n8nNode", node: "n8n-nodes-base.serviceNow", typeVersion: 1, parameters: { resource: "tableRecord", operation: "create", tableName: "pm_project_task", fieldsToSend: "defined", fields: { field: [{ column: "short_description", value: "={{ $json.body.payload.title }}" }, { column: "parent", value: "={{ $json.body.payload.projectId }}" }] } } },
      update_issue: { kind: "n8nNode", node: "n8n-nodes-base.serviceNow", typeVersion: 1, parameters: { resource: "tableRecord", operation: "update", tableName: "pm_project_task", id: "={{ $json.body.payload.issueId }}", fields: { field: [{ column: "short_description", value: "={{ $json.body.payload.title }}" }] } } },
      delete_issue: { kind: "n8nNode", node: "n8n-nodes-base.serviceNow", typeVersion: 1, parameters: { resource: "tableRecord", operation: "delete", tableName: "pm_project_task", id: "={{ $json.body.payload.issueId }}" } },
    },
    notes: "Uses the generic tableRecord resource against the PPM tables (pm_project / pm_project_task). Adjust table/field names to your ServiceNow PPM model.",
  },
  {
    id: "trello",
    label: "Trello",
    docsUrl: "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.trello/",
    via: "Native n8n node (trelloApi credential)",
    authHeader: "",
    requiredEnv: [],
    credentialType: "trelloApi",
    capabilities: { ...CAPS_CORE, scheduling: false },
    actions: {
      list_issues: { kind: "n8nNode", node: "n8n-nodes-base.trello", typeVersion: 1, parameters: { resource: "list", operation: "getCards", id: "={{ $json.body.payload.projectId }}" }, note: "projectId = a Trello list id; cards on the list map to issues." },
      create_issue: { kind: "n8nNode", node: "n8n-nodes-base.trello", typeVersion: 1, parameters: { resource: "card", operation: "create", listId: "={{ $json.body.payload.projectId }}", name: "={{ $json.body.payload.title }}", description: "={{ $json.body.payload.description }}" } },
      update_issue: { kind: "n8nNode", node: "n8n-nodes-base.trello", typeVersion: 1, parameters: { resource: "card", operation: "update", id: "={{ $json.body.payload.issueId }}", updateFields: { name: "={{ $json.body.payload.title }}" } } },
      delete_issue: { kind: "n8nNode", node: "n8n-nodes-base.trello", typeVersion: 1, parameters: { resource: "card", operation: "delete", id: "={{ $json.body.payload.issueId }}" } },
      list_projects: { kind: "n8nNode", node: "n8n-nodes-base.trello", typeVersion: 1, parameters: { resource: "board", operation: "get", id: "={{ $json.body.payload.projectId }}" }, note: "Trello has no list-all-boards node op — fetch member boards via an extra node, or map boards→projects, lists→projects to taste." },
    },
    notes: "Kanban-shaped: boards/lists → projects, cards → issues. Scheduling off unless you use Trello due dates.",
  },
  {
    id: "wrike",
    label: "Wrike",
    docsUrl: "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.wrike/",
    via: "Native n8n node (wrikeOAuth2Api credential)",
    authHeader: "",
    requiredEnv: [],
    credentialType: "wrikeOAuth2Api",
    capabilities: { ...CAPS_CORE },
    actions: {
      list_projects: { kind: "n8nNode", node: "n8n-nodes-base.wrike", typeVersion: 1, parameters: { resource: "folder", operation: "getAll", returnAll: true } },
      list_issues: { kind: "n8nNode", node: "n8n-nodes-base.wrike", typeVersion: 1, parameters: { resource: "task", operation: "getAll", returnAll: true, folderId: "={{ $json.body.payload.projectId }}" } },
      create_issue: { kind: "n8nNode", node: "n8n-nodes-base.wrike", typeVersion: 1, parameters: { resource: "task", operation: "create", folderId: "={{ $json.body.payload.projectId }}", title: "={{ $json.body.payload.title }}" } },
      update_issue: { kind: "n8nNode", node: "n8n-nodes-base.wrike", typeVersion: 1, parameters: { resource: "task", operation: "update", id: "={{ $json.body.payload.issueId }}", title: "={{ $json.body.payload.title }}" } },
      delete_issue: { kind: "n8nNode", node: "n8n-nodes-base.wrike", typeVersion: 1, parameters: { resource: "task", operation: "delete", id: "={{ $json.body.payload.issueId }}" } },
    },
    notes: "Folders/projects → projects, tasks → issues.",
  },
  {
    id: "clickup",
    label: "ClickUp",
    docsUrl: "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.clickup/",
    via: "Native n8n node (clickUpApi credential)",
    authHeader: "",
    requiredEnv: ["CLICKUP_SPACE_ID"],
    credentialType: "clickUpApi",
    capabilities: { ...CAPS_CORE },
    actions: {
      list_projects: { kind: "n8nNode", node: "n8n-nodes-base.clickUp", typeVersion: 1, parameters: { resource: "folder", operation: "getAll", space: "={{ $env.CLICKUP_SPACE_ID }}", returnAll: true }, note: "Folders in the space map to projects; or use lists directly." },
      list_issues: { kind: "n8nNode", node: "n8n-nodes-base.clickUp", typeVersion: 1, parameters: { resource: "task", operation: "getAll", returnAll: true, list: "={{ $json.body.payload.projectId }}" }, note: "projectId = ClickUp list id." },
      create_issue: { kind: "n8nNode", node: "n8n-nodes-base.clickUp", typeVersion: 1, parameters: { resource: "task", operation: "create", list: "={{ $json.body.payload.projectId }}", name: "={{ $json.body.payload.title }}" } },
      update_issue: { kind: "n8nNode", node: "n8n-nodes-base.clickUp", typeVersion: 1, parameters: { resource: "task", operation: "update", id: "={{ $json.body.payload.issueId }}", updateFields: { name: "={{ $json.body.payload.title }}" } } },
      delete_issue: { kind: "n8nNode", node: "n8n-nodes-base.clickUp", typeVersion: 1, parameters: { resource: "task", operation: "delete", id: "={{ $json.body.payload.issueId }}" } },
    },
    notes: "Spaces/lists → projects, tasks → issues. List all lists via an extra node if you want list_projects.",
  },

  // ── Microsoft: HTTP via Dataverse with n8n-managed OAuth credential ──────────
  {
    id: "dynamics365",
    label: "Microsoft Dynamics 365 (Project Operations)",
    docsUrl: "https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview",
    via: "HTTP + n8n-managed Dynamics OAuth (Dataverse Web API)",
    authHeader: "",
    requiredEnv: ["DATAVERSE_URL"],
    credentialType: "microsoftDynamicsOAuth2Api",
    capabilities: { ...CAPS_CORE, portfolio: true, financials: true, resources: true, baseline: true },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projects" },
      list_issues: { method: "GET", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projecttasks?$filter=_msdyn_project_value eq {{ $json.body.payload.projectId }}" },
      create_issue: { method: "POST", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projecttasks", body: "={{ JSON.stringify({ msdyn_subject: $json.body.payload.title }) }}" },
      update_issue: { method: "PATCH", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projecttasks({{ $json.body.payload.issueId }})", body: "={{ JSON.stringify({ msdyn_subject: $json.body.payload.title }) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projecttasks({{ $json.body.payload.issueId }})" },
    },
    notes: "Auth is handled by n8n's Microsoft Dynamics OAuth2 credential (no per-user token). Project Operations runs on Dataverse — msdyn_project / msdyn_projecttask, with finance entities for EVM. DATAVERSE_URL e.g. https://org.crm.dynamics.com.",
  },
  {
    id: "msproject",
    label: "Microsoft Project (Project for the web)",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/project-operations/",
    via: "HTTP + n8n-managed Dynamics OAuth (Dataverse Web API)",
    authHeader: "",
    requiredEnv: ["DATAVERSE_URL"],
    credentialType: "microsoftDynamicsOAuth2Api",
    capabilities: { ...CAPS_CORE, baseline: true },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projects?$select=msdyn_subject,msdyn_scheduledstart,msdyn_scheduledend" },
      list_issues: { method: "GET", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projecttasks?$filter=_msdyn_project_value eq {{ $json.body.payload.projectId }}&$select=msdyn_subject,msdyn_start,msdyn_finish,msdyn_progress" },
      create_issue: { method: "POST", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projecttasks", body: "={{ JSON.stringify({ msdyn_subject: $json.body.payload.title }) }}" },
      update_issue: { method: "PATCH", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projecttasks({{ $json.body.payload.issueId }})", body: "={{ JSON.stringify({ msdyn_subject: $json.body.payload.title }) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.DATAVERSE_URL }}/api/data/v9.2/msdyn_projecttasks({{ $json.body.payload.issueId }})" },
    },
    notes: "Project for the web stores schedules in Dataverse (msdyn_project / msdyn_projecttask). For classic Project Online, point at the PWA OData (/_api/ProjectData) with a Microsoft OAuth credential instead.",
  },

  // ── Massive corporate backbones (HTTP + n8n-managed credential) ─────────────
  {
    id: "sap",
    label: "SAP S/4HANA (Enterprise Project / PS)",
    docsUrl: "https://api.sap.com/api/API_ENTERPRISE_PROJECT_SRV/overview",
    via: "HTTP + n8n OAuth2 credential (OData; Basic on-prem)",
    authHeader: "",
    requiredEnv: ["SAP_S4_URL"],
    credentialType: "oAuth2Api",
    capabilities: { ...CAPS_CORE, portfolio: true, financials: true, resources: true, baseline: true },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.SAP_S4_URL }}/sap/opu/odata/sap/API_ENTERPRISE_PROJECT_SRV/A_EnterpriseProject?$format=json" },
      list_issues: { method: "GET", url: "={{ $env.SAP_S4_URL }}/sap/opu/odata/sap/API_ENTERPRISE_PROJECT_SRV/A_EnterpriseProjectElement?$filter=ProjectUUID eq {{ $json.body.payload.projectId }}&$format=json" },
      create_issue: { method: "POST", url: "={{ $env.SAP_S4_URL }}/sap/opu/odata/sap/API_ENTERPRISE_PROJECT_SRV/A_EnterpriseProjectElement", body: "={{ JSON.stringify({ ProjectElementDescription: $json.body.payload.title }) }}", note: "SAP OData writes require a CSRF token: add a GET node sending 'X-CSRF-Token: Fetch', then pass the returned token + cookies on this write." },
      update_issue: { method: "PATCH", url: "={{ $env.SAP_S4_URL }}/sap/opu/odata/sap/API_ENTERPRISE_PROJECT_SRV/A_EnterpriseProjectElement(guid'{{ $json.body.payload.issueId }}')", body: "={{ JSON.stringify({ ProjectElementDescription: $json.body.payload.title }) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.SAP_S4_URL }}/sap/opu/odata/sap/API_ENTERPRISE_PROJECT_SRV/A_EnterpriseProjectElement(guid'{{ $json.body.payload.issueId }}')" },
    },
    notes: "S/4HANA Project System / Enterprise Project Management via OData. Auth via n8n's OAuth2 credential (S/4HANA Cloud) or switch to httpBasicAuth on-prem. Writes need the X-CSRF-Token handshake. For classic RFC/BAPI use an SAP community node or route through SAP Integration Suite / PI-PO.",
  },
  {
    id: "primavera",
    label: "Oracle Primavera P6 EPPM",
    docsUrl: "https://docs.oracle.com/cd/F25600_01/English/Integration/P6_Integration_API/index.htm",
    via: "HTTP + n8n Basic credential (P6 REST)",
    authHeader: "",
    requiredEnv: ["P6_URL"],
    credentialType: "httpBasicAuth",
    capabilities: { ...CAPS_CORE, portfolio: true, resources: true, baseline: true },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.P6_URL }}/p6ws/restapi/project" },
      list_issues: { method: "GET", url: "={{ $env.P6_URL }}/p6ws/restapi/activity?ProjectObjectId={{ $json.body.payload.projectId }}" },
      create_issue: { method: "POST", url: "={{ $env.P6_URL }}/p6ws/restapi/activity", body: "={{ JSON.stringify([{ Name: $json.body.payload.title, ProjectObjectId: $json.body.payload.projectId }]) }}" },
      update_issue: { method: "PUT", url: "={{ $env.P6_URL }}/p6ws/restapi/activity", body: "={{ JSON.stringify([{ ObjectId: $json.body.payload.issueId, Name: $json.body.payload.title }]) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.P6_URL }}/p6ws/restapi/activity/{{ $json.body.payload.issueId }}" },
    },
    notes: "Primavera P6 EPPM REST: projects → projects, activities → issues; baselines + resource assignments are first-class. Endpoint shapes vary by P6 version — confirm against your /p6ws/restapi build.",
  },
  {
    id: "enterprise",
    label: "Enterprise backbone (Capita / custom REST / OData / SOAP)",
    docsUrl: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/",
    via: "HTTP + n8n credential — point at your endpoint",
    authHeader: "",
    requiredEnv: ["BACKBONE_BASE_URL"],
    credentialType: "httpHeaderAuth",
    capabilities: { ...CAPS_CORE },
    actions: {
      list_projects: { method: "GET", url: "={{ $env.BACKBONE_BASE_URL }}/projects" },
      list_issues: { method: "GET", url: "={{ $env.BACKBONE_BASE_URL }}/projects/{{ $json.body.payload.projectId }}/items" },
      create_issue: { method: "POST", url: "={{ $env.BACKBONE_BASE_URL }}/projects/{{ $json.body.payload.projectId }}/items", body: "={{ JSON.stringify({ title: $json.body.payload.title, description: $json.body.payload.description }) }}" },
      update_issue: { method: "PATCH", url: "={{ $env.BACKBONE_BASE_URL }}/items/{{ $json.body.payload.issueId }}", body: "={{ JSON.stringify({ title: $json.body.payload.title }) }}" },
      delete_issue: { method: "DELETE", url: "={{ $env.BACKBONE_BASE_URL }}/items/{{ $json.body.payload.issueId }}" },
    },
    notes: "A starting template for bespoke corporate systems — Capita platforms, ESB/SOA gateways, mainframe-fronting REST. Auth via n8n's generic Header-Auth/OAuth2 credential. For SOAP backbones set the HTTP node to send XML (or use a SOAP community node); for message buses (IBM MQ, Kafka, RabbitMQ) trigger via the matching n8n node and call back through /api/notifications/ingest or a follow-up action.",
  },
];

export function getBackend(id: string): BackendManifest | undefined {
  return BACKENDS.find((b) => b.id === id);
}

/**
 * Enterprise-tier backends. Generating an importable n8n workflow for these is a
 * premium capability (licence feature `enterprise_workflows`) — they target the
 * large corporate ERPs / scheduling systems that are the paid-for integrations.
 * The standard backends (Jira, OpenProject, GitHub, …) stay free.
 */
const ENTERPRISE_BACKENDS = new Set(["sap", "primavera", "dynamics365", "msproject", "enterprise"]);

export function isEnterpriseBackend(id: string): boolean {
  return ENTERPRISE_BACKENDS.has(id);
}

export type BackendTier = "standard" | "enterprise";

/** Lightweight catalogue for the wizard UI (no n8n expressions). */
export function backendCatalogue() {
  return BACKENDS.map((b) => ({
    id: b.id,
    label: b.label,
    docsUrl: b.docsUrl,
    via: b.via,
    credentialType: b.credentialType ?? null,
    requiredEnv: b.requiredEnv,
    actions: Object.keys(b.actions),
    capabilities: b.capabilities,
    notes: b.notes,
    tier: (isEnterpriseBackend(b.id) ? "enterprise" : "standard") as BackendTier,
  }));
}
