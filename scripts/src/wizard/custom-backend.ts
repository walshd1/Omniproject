import { generateWorkflow, getBackend, isEnterpriseBackend, type BackendDefinition, type ContractAction, type ActionMapping } from "@workspace/backend-catalogue";

/**
 * Onboarding a backend OmniProject doesn't ship a mapping for yet ("custom", or
 * an enterprise placeholder with no actions). Rather than leave the operator with
 * a blank n8n, we scaffold a STRUCTURALLY-VALID, importable workflow skeleton —
 * webhook → route(action) → one HTTP node per contract action with placeholder
 * URLs — plus a step-by-step binding guide that walks them through discovering
 * their API, filling the nodes, normalising responses and verifying.
 *
 * The skeleton is produced by the SAME tested generator the shipped backends use
 * (n8n-generator.generateWorkflow); we just feed it a placeholder manifest. So a
 * "new backend" is the shipped happy-path minus the operator's API specifics.
 */

const API = "={{ $env.CUSTOM_API_BASE }}"; // operator sets CUSTOM_API_BASE in n8n
// Forward the signed-in user's OIDC token (per-user impersonation) by default.
const USER_BEARER = "=Bearer {{ $json.body.payload.userContext.token }}";

/** The minimum contract actions a backend must implement to be useful. */
export const SKELETON_ACTIONS: { action: ContractAction; mapping: ActionMapping; write: boolean }[] = [
  { action: "list_projects", write: false, mapping: { method: "GET", url: `${API}/projects`, note: "Return an array of projects. Map each to {id,name,...}." } },
  { action: "list_issues", write: false, mapping: { method: "GET", url: `${API}/projects/{{ $json.body.payload.projectId }}/issues`, note: "Return the project's work items as an array." } },
  { action: "create_issue", write: true, mapping: { method: "POST", url: `${API}/projects/{{ $json.body.payload.projectId }}/issues`, body: "={{ JSON.stringify($json.body.payload) }}", note: "Create a work item; return the created record with its id + version." } },
  { action: "update_issue", write: true, mapping: { method: "PATCH", url: `${API}/issues/{{ $json.body.payload.issueId }}`, body: "={{ JSON.stringify($json.body.payload) }}", note: "Update; honour expectedVersion → return 409 on mismatch (optimistic concurrency)." } },
  { action: "delete_issue", write: true, mapping: { method: "DELETE", url: `${API}/issues/{{ $json.body.payload.issueId }}`, note: "Delete the work item." } },
  { action: "get_capabilities", write: false, mapping: { method: "GET", url: `${API}/capabilities`, note: "Return capability flags, or replace this node with a Set node returning a static object (issues:true, scheduling:true, …)." } },
];

/** True when this backend has no shipped mapping and needs guided onboarding. */
export function isCustomBackend(id: string): boolean {
  if (id === "custom") return true;
  const b = getBackend(id);
  return !b || Object.keys(b.actions).length === 0;
}

function placeholderManifest(id: string, label: string): BackendDefinition {
  return {
    id,
    label,
    docsUrl: "https://your-backend.example.com/api-docs",
    via: "Custom HTTP binding (fill in the endpoints + auth in n8n)",
    authHeader: USER_BEARER,
    requiredEnv: ["CUSTOM_API_BASE"],
    capabilities: { issues: true, scheduling: false, portfolio: false, resources: false, financials: false, baseline: false, blockers: false, history: false, raid: false },
    actions: Object.fromEntries(SKELETON_ACTIONS.map((a) => [a.action, a.mapping])) as BackendDefinition["actions"],
    notes: "Generated skeleton — replace the placeholder URLs/auth with your backend's real API.",
  };
}

/** A structurally-valid, importable n8n workflow skeleton for a custom backend. */
export function renderSkeletonWorkflow(id: string, label: string): string {
  return JSON.stringify(generateWorkflow(placeholderManifest(id, label), { webhookPath: "omniproject" }), null, 2) + "\n";
}

/** For a SHIPPED backend, the ready-to-import workflow (or null if it has no mapping). */
export function renderKnownWorkflow(id: string): string | null {
  const b = getBackend(id);
  if (!b || Object.keys(b.actions).length === 0) return null;
  return JSON.stringify(generateWorkflow(b, { webhookPath: "omniproject" }), null, 2) + "\n";
}

/**
 * A contributable `BackendManifest` source stub — paste into the BACKENDS array
 * in `lib/backend-catalogue/src/backend-catalogue.ts` to promote a custom backend to a
 * first-class shipped catalogue entry (so the wizard + gateway both know it next
 * time). Mirrors the skeleton's action mappings.
 */
export function renderManifestSource(id: string, label: string): string {
  const actions = SKELETON_ACTIONS.map((a) => {
    const m = a.mapping;
    const parts = [`method: ${JSON.stringify(m.method)}`, `url: ${JSON.stringify(m.url)}`];
    if (m.body) parts.push(`body: ${JSON.stringify(m.body)}`);
    if (m.note) parts.push(`note: ${JSON.stringify(m.note)}`);
    return `    ${a.action}: { ${parts.join(", ")} },`;
  }).join("\n");
  return `// Contributed catalogue entry for ${label}.
// 1. Replace the placeholder URLs/auth/capabilities with your real backend's.
// 2. Add this object to the BACKENDS array in
//    lib/backend-catalogue/src/backend-catalogue.ts.
// 3. Run \`pnpm --filter @workspace/scripts gen-contract\` + the test suites.
{
  id: ${JSON.stringify(id)},
  label: ${JSON.stringify(label)},
  docsUrl: "https://your-backend.example.com/api-docs",
  via: "Custom HTTP binding (fill in endpoints + auth)",
  authHeader: ${JSON.stringify(USER_BEARER)},
  requiredEnv: ["CUSTOM_API_BASE"],
  capabilities: { issues: true, scheduling: false, portfolio: false, resources: false, financials: false, baseline: false, blockers: false, history: false, raid: false },
  actions: {
${actions}
  },
  notes: "Generated stub — replace placeholders, then contribute back.",
},
`;
}

// Canonical fields by domain (subset of FIELD_REGISTRY) for the field-map stub.
// Core/people/schedule default to supported; advanced domains start off so the
// operator enables only what their backend actually has.
const FIELDMAP: { on: string[]; off: string[] } = {
  on: ["title", "status", "description", "assignee", "reporter", "priority", "labels", "type", "startDate", "dueDate", "completionPct"],
  off: ["milestone", "estimateHours", "loggedHours", "remainingHours", "storyPoints", "sprint", "epic", "parentTask", "dependsOn", "budget", "plannedCost", "actualCost", "currency", "billable", "dealValue", "probability", "forecastCategory", "slaBreached", "csat"],
};

/**
 * A contributable `BackendFieldMap` stub (surface/store per field + entity). The
 * backend can return this from a field-map action, or an admin can load it via
 * the translation-layer editor. Operator flips on the fields their backend has.
 */
export function renderFieldMap(id: string): string {
  const sup = (v: boolean) => ({ surface: v, store: v });
  const fields: Record<string, { surface: boolean; store: boolean }> = {};
  for (const f of FIELDMAP.on) fields[f] = sup(true);
  for (const f of FIELDMAP.off) fields[f] = sup(false);
  const map = {
    _comment: `Field map for "${id}". surface=can read, store=can write. Flip the advanced fields on as your backend supports them. Canonical field keys: see GET /api/contract and docs/FIELD-CATALOGUE.md.`,
    fields,
    entities: { project: sup(true), issue: sup(true), programme: sup(false), taskChildren: sup(false) },
  };
  return JSON.stringify(map, null, 2) + "\n";
}

/** The step-by-step binding guide for onboarding a custom backend. */
export function renderBindingGuide(id: string, label: string): string {
  const tier = isEnterpriseBackend(id) ? " (enterprise)" : "";
  const actionRows = SKELETON_ACTIONS.map((a) => `| \`${a.action}\` | ${a.mapping.method} | ${a.write ? "write" : "read"} | ${a.mapping.note ?? ""} |`).join("\n");
  return `# Onboarding a new backend: ${label}${tier}

OmniProject doesn't ship a mapping for this backend yet, so this is the guided
path. The generated \`${id}.workflow.json\` is a **structurally-valid n8n workflow
skeleton** — it already speaks the gateway contract (webhook → route by action →
respond); you only fill in YOUR backend's API specifics.

## 1. Import the skeleton
- Open n8n → **Import from File** → \`${id}.workflow.json\`.
- It exposes a webhook at \`/webhook/omniproject\` — this is your \`BROKER_URL\`.

## 2. Discover your backend's API
Set **\`CUSTOM_API_BASE\`** in n8n (Settings → Variables) to your API root. The HTTP
nodes reference \`{{ $env.CUSTOM_API_BASE }}\`. For each node below, fix the URL,
method and query/body to match your API (see your backend's API docs / OpenAPI):

| Action | Method | Kind | What it must do |
| --- | --- | --- | --- |
${actionRows}

## 3. Authentication
By default each node forwards the **signed-in user's OIDC token** as
\`Authorization: Bearer …\` (per-user impersonation — the backend authorises). If
your backend uses an API key or OAuth, attach an **n8n credential** to the HTTP
nodes instead and remove the forwarded header.

## 4. Normalise responses to the contract
The gateway expects normalised shapes (\`{id,name,…}\` for projects;
\`{id,projectId,title,status,version,…}\` for issues) wrapped as
\`{ success, data }\`. Add a **Set/Code node** after each HTTP node to map your
backend's fields onto the contract. The canonical shapes are at
\`GET /api/contract\` and in \`docs/BROKER-HTTP-BINDING.md\`.

## 5. Surface your custom fields (describe → reconcile)
Any backend field you don't map still flows through: point OmniProject's
**describe → reconcile** discovery at your API and it auto-surfaces unknown fields
into the data-lineage overlay (capability-gated), so you don't have to enumerate
every field up front.

## 6. Verify before you rely on it
- Admin UI: **Settings → test broker** (\`POST /api/setup/test-n8n\`) probes
  reachability + capabilities.
- Conformance over the wire:
  \`\`\`bash
  SMOKE_BROKER_URL=<your n8n webhook URL> SMOKE_AUTH="Bearer <token>" \\
    pnpm --filter @workspace/api-server smoke           # add SMOKE_WRITE=1 to test writes
  \`\`\`
- Set \`BACKEND_SOURCE=${id}\` so the gateway labels the data lineage correctly.

## 7. Make it permanent (optional)
If you generated the contribution files, you have:
- \`${id}.backend.ts\` — a **catalogue entry** (\`BackendManifest\`). Drop it into the
  \`BACKENDS\` array in \`lib/backend-catalogue/src/backend-catalogue.ts\` and it becomes a
  first-class backend the wizard + gateway both offer next time.
- \`${id}.fieldmap.json\` — a **field map** (\`surface\`/\`store\` per field + entity).
  Serve it from your broker's field-map action, or load it via the admin
  translation-layer editor, so the UI only shows fields your backend really has.

When conformance is green, this backend is a first-class citizen — no core changes
needed. Consider contributing both back upstream so others get it for free.
`;
}
