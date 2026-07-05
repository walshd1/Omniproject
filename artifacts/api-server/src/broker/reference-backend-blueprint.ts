import type { BackendDefinition } from "@workspace/backend-catalogue";

/**
 * REFERENCE BACKEND BLUEPRINT — a complete-but-placeholder backend binding to
 * copy from (the backend plane's deliberately non-functional reference).
 *
 * It maps EVERY contract action and declares the full capability + required-env
 * surface, but every URL is a `{{ $env.YOUR_API_BASE }}` placeholder and the
 * advanced capabilities are off — so it is NOT in the shipped BACKENDS array and
 * can't be selected/deployed as-is. Copy it, fill in your API's endpoints / auth /
 * capabilities, add it to the catalogue, and run the conformance suite. (The setup
 * wizard's guided onboarding generates this for you from a few questions.)
 */

const API = "={{ $env.YOUR_API_BASE }}";
const USER_BEARER = "=Bearer {{ $json.body.payload.userContext.token }}";

export const REFERENCE_BACKEND: BackendDefinition = {
  id: "reference-backend",
  label: "Reference backend (TEMPLATE — replace me)",
  docsUrl: "https://your-backend.example.com/api-docs",
  verification: "experimental",
  via: "Custom HTTP binding — fill in the endpoints + auth",
  authHeader: USER_BEARER, // forwards the signed-in user's token; swap for an n8n credential if needed
  requiredEnv: ["YOUR_API_BASE"],
  // TODO: turn on only the domains your backend can actually populate.
  capabilities: { issues: true, scheduling: false, portfolio: false, resources: false, financials: false, baseline: false, blockers: false, history: false, raid: false },
  actions: {
    list_projects: { method: "GET", url: `${API}/projects`, note: "TODO: return an array of projects → normalise to {id,name,…}." },
    list_issues: { method: "GET", url: `${API}/projects/{{ $json.body.payload.projectId }}/issues`, note: "TODO: the project's work items." },
    create_issue: { method: "POST", url: `${API}/projects/{{ $json.body.payload.projectId }}/issues`, body: "={{ JSON.stringify($json.body.payload) }}", note: "TODO: return the created record with id + version." },
    update_issue: { method: "PATCH", url: `${API}/issues/{{ $json.body.payload.issueId }}`, body: "={{ JSON.stringify($json.body.payload) }}", note: "TODO: honour expectedVersion → 409 on mismatch." },
    delete_issue: { method: "DELETE", url: `${API}/issues/{{ $json.body.payload.issueId }}` },
    get_capabilities: { method: "GET", url: `${API}/capabilities`, note: "TODO: or replace this node with a static Set returning your capability flags." },
  },
  notes: "TEMPLATE — not a real backend. Copy, fill the placeholders, add to BACKENDS, run conformance.",
};

/** A starter field map (surface = can read, store = can write). Flip on the
 *  fields your backend actually has; serve from a field-map action or load via the
 *  admin translation-layer editor. */
export const REFERENCE_FIELD_MAP = {
  fields: {
    title: { surface: true, store: true },
    status: { surface: true, store: true },
    description: { surface: true, store: true },
    assignee: { surface: true, store: true },
    dueDate: { surface: true, store: false }, // example: read-only field
    // TODO: add the rest from docs/FIELD-CATALOGUE.md as your backend supports them.
  },
  entities: { project: { surface: true, store: true }, issue: { surface: true, store: true } },
};
