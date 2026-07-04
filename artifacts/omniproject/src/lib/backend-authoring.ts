import type { BackendManifest, ActionMapping, ContractAction, KeyFormat } from "@workspace/backend-catalogue";
import { validateVendor, getBackend, ACTION_KINDS } from "@workspace/backend-catalogue";
import { safeParseJson } from "./safe-json";
import { downloadJson } from "./custom-report-file";

/**
 * Self-service backend/vendor authoring (backlog #137) — build a valid
 * `BackendManifest & BrokerBinding` JSON document through a guided form instead of
 * hand-editing `lib/backend-catalogue/vendors/backends/<id>.json`.
 *
 * IMPORTANT — this is authoring + validation + EXPORT, not a live write path.
 * OmniProject already lets a deployment add/override backends WITHOUT a rebuild
 * by dropping validated JSON into `$OMNI_CONFIG_DIR/vendors/backends/*.json` (see
 * `lib/backend-catalogue/vendors/README.md` and `artifacts/api-server/src/lib/
 * config-dir.ts` — `loadVendors` calls `registerVendor`, which runs the EXACT
 * schema below). There is no admin-triggered API that writes into that directory
 * at runtime (writing to the server's filesystem from the SPA would also be wrong
 * for a stateless/zero-at-rest gateway) — so the UI's job ends at producing a
 * correct file for the operator to place and reload/restart. `evaluateDraft` runs
 * `validateVendor("backends", …)`, the SAME schema (`vendors/schema/
 * backend.schema.json`, embedded as `VENDOR_SCHEMAS`) the config-dir loader and
 * `gen-vendors` enforce, so "valid in this form" ⇔ "the loader will accept it".
 */

/** The six contract actions a binding can map (broker-neutral; see `ContractAction`). */
export const CONTRACT_ACTIONS: ContractAction[] = ["list_projects", "list_issues", "create_issue", "update_issue", "delete_issue", "get_capabilities"];

/**
 * The neutral capability domains a backend can declare against — mirrors
 * `CAPABILITY_DOMAINS` in `artifacts/api-server/src/lib/capabilities.ts` (the
 * gateway's single source of truth). Kept in sync by hand, the same soft
 * duplication `CAP_DOMAINS` in `components/setup/shared.tsx` already accepts for
 * its subset — a drift here only weakens this form's inline hint (which
 * capability ids are "known"), never actual validity: `evaluateDraft` always
 * defers pass/fail to the embedded JSON-Schema, which allows any boolean
 * capability key (forward-compatible), so a stale list here can only under-warn,
 * never wrongly reject a definition.
 */
export const CAPABILITY_DOMAINS = [
  "issues", "scheduling", "resources", "financials", "portfolio", "baseline", "blockers", "history", "raid",
  "quality", "crm", "service", "benefits", "stakeholders", "raci",
] as const;

export const KEY_SCHEMES: NonNullable<KeyFormat["scheme"]>[] = ["psk", "bearer", "apiKey", "basic", "oauth2", "per-user", "none"];
export const BACKEND_KINDS: NonNullable<BackendManifest["kind"]>[] = ["live", "import", "database"];
export { ACTION_KINDS };
export const HTTP_METHODS: NonNullable<ActionMapping["method"]>[] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

/** One contract action's editable form state — a looser, string-friendly shadow of `ActionMapping`. */
export interface ActionDraft {
  /** Whether this action is mapped at all (unmapped actions are omitted from the built JSON). */
  enabled: boolean;
  kind: NonNullable<ActionMapping["kind"]> | "";
  method: NonNullable<ActionMapping["method"]> | "";
  url: string;
  body: string;
  credentialType: string;
  node: string;
  /** Kept as text in the form; parsed to a number on build. */
  typeVersion: string;
  /** Raw JSON text for the n8n node `parameters` object. */
  parameters: string;
  note: string;
}

/** The full form state for one backend/vendor definition — a string-friendly shadow of
 *  `BackendManifest & BrokerBinding` (the `BackendDefinition` catalogue entry shape). */
export interface BackendDraft {
  id: string;
  label: string;
  docsUrl: string;
  via: string;
  requiredEnv: string[];
  capabilities: Record<string, boolean>;
  kind: NonNullable<BackendManifest["kind"]> | "";
  adminOnly: boolean;
  notes: string;
  keyFormat: { enabled: boolean; scheme: NonNullable<KeyFormat["scheme"]> | ""; env: string[]; header: string; pattern: string };
  authHeader: string;
  credentialType: string;
  actions: Record<ContractAction, ActionDraft>;
}

function emptyActionDraft(): ActionDraft {
  return { enabled: false, kind: "", method: "", url: "", body: "", credentialType: "", node: "", typeVersion: "", parameters: "", note: "" };
}

/** A blank draft to start authoring a new backend from scratch. */
export function emptyBackendDraft(): BackendDraft {
  return {
    id: "",
    label: "",
    docsUrl: "",
    via: "",
    requiredEnv: [],
    capabilities: Object.fromEntries(CAPABILITY_DOMAINS.map((d) => [d, false])),
    kind: "",
    adminOnly: false,
    notes: "",
    keyFormat: { enabled: false, scheme: "", env: [], header: "", pattern: "" },
    authHeader: "",
    credentialType: "",
    actions: Object.fromEntries(CONTRACT_ACTIONS.map((a) => [a, emptyActionDraft()])) as Record<ContractAction, ActionDraft>,
  };
}

function actionMappingToDraft(m: ActionMapping | undefined): ActionDraft {
  if (!m) return emptyActionDraft();
  return {
    enabled: true,
    kind: m.kind ?? "",
    method: m.method ?? "",
    url: m.url ?? "",
    body: m.body ?? "",
    credentialType: m.credentialType ?? "",
    node: m.node ?? "",
    typeVersion: m.typeVersion != null ? String(m.typeVersion) : "",
    parameters: m.parameters ? JSON.stringify(m.parameters, null, 2) : "",
    note: m.note ?? "",
  };
}

/** Map an arbitrary (already-validated or not) object into an editable draft — used both to
 *  clone a shipped catalogue backend as a starting point and to resume an imported file. Unknown
 *  or malformed fields are dropped rather than thrown on, so a partial/hand-edited file still loads. */
export function toDraft(value: Record<string, unknown>): BackendDraft {
  const base = emptyBackendDraft();

  const capabilities = { ...base.capabilities };
  if (value["capabilities"] && typeof value["capabilities"] === "object") {
    for (const [k, v] of Object.entries(value["capabilities"] as Record<string, unknown>)) capabilities[k] = !!v;
  }

  const actions = { ...base.actions };
  if (value["actions"] && typeof value["actions"] === "object") {
    for (const [k, v] of Object.entries(value["actions"] as Record<string, ActionMapping>)) {
      if ((CONTRACT_ACTIONS as string[]).includes(k)) actions[k as ContractAction] = actionMappingToDraft(v);
    }
  }

  const kf = value["keyFormat"] as Partial<KeyFormat> | undefined;

  return {
    ...base,
    id: typeof value["id"] === "string" ? value["id"] : "",
    label: typeof value["label"] === "string" ? value["label"] : "",
    docsUrl: typeof value["docsUrl"] === "string" ? value["docsUrl"] : "",
    via: typeof value["via"] === "string" ? value["via"] : "",
    requiredEnv: Array.isArray(value["requiredEnv"]) ? (value["requiredEnv"] as unknown[]).filter((e): e is string => typeof e === "string") : [],
    capabilities,
    kind: (BACKEND_KINDS as string[]).includes(value["kind"] as string) ? (value["kind"] as BackendDraft["kind"]) : "",
    adminOnly: !!value["adminOnly"],
    notes: typeof value["notes"] === "string" ? value["notes"] : "",
    keyFormat: kf
      ? { enabled: true, scheme: kf.scheme ?? "", env: kf.env ?? [], header: kf.header ?? "", pattern: kf.pattern ?? "" }
      : base.keyFormat,
    authHeader: typeof value["authHeader"] === "string" ? value["authHeader"] : "",
    credentialType: typeof value["credentialType"] === "string" ? value["credentialType"] : "",
    actions,
  };
}

/** Clone a shipped catalogue backend as a starting draft (vendors/README's "copy an existing file" step,
 *  through the UI). Returns null for an unknown id. */
export function cloneFromCatalogue(id: string): BackendDraft | null {
  const def = getBackend(id);
  return def ? toDraft(def as unknown as Record<string, unknown>) : null;
}

/** Parse an uploaded/pasted backend definition file into a draft, throwing a friendly error if it
 *  isn't a single JSON object. */
export function parseBackendFile(text: string): BackendDraft {
  let parsed: unknown;
  try {
    parsed = safeParseJson(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a single backend definition object.");
  return toDraft(parsed as Record<string, unknown>);
}

export interface DraftEvaluation {
  /** The manifest as it would be written to disk (best-effort even when invalid, for the live preview). */
  manifest: Record<string, unknown>;
  /** Blocking problems — the same schema the config-dir loader enforces, plus JSON parse errors, would reject this. */
  errors: string[];
  /** Non-blocking advisories (unrecognised capability id, no actions mapped, id collides with a shipped backend). */
  warnings: string[];
}

/** Build the exported JSON (trimming blanks/disabled actions), collecting the blocking problems
 *  that only surface while building it (a malformed type version or `parameters` JSON blob). */
function buildManifest(draft: BackendDraft): { manifest: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const actions: Record<string, ActionMapping> = {};

  for (const action of CONTRACT_ACTIONS) {
    const a = draft.actions[action];
    if (!a || !a.enabled) continue;
    const mapping: Record<string, unknown> = {};
    if (a.kind) mapping["kind"] = a.kind;
    if (a.method) mapping["method"] = a.method;
    if (a.url.trim()) mapping["url"] = a.url.trim();
    if (a.body.trim()) mapping["body"] = a.body.trim();
    if (a.credentialType.trim()) mapping["credentialType"] = a.credentialType.trim();
    if (a.node.trim()) mapping["node"] = a.node.trim();
    if (a.typeVersion.trim()) {
      const n = Number(a.typeVersion);
      if (Number.isFinite(n)) mapping["typeVersion"] = n;
      else errors.push(`${action}: type version must be a number`);
    }
    if (a.parameters.trim()) {
      try {
        mapping["parameters"] = safeParseJson(a.parameters);
      } catch {
        errors.push(`${action}: parameters is not valid JSON`);
      }
    }
    if (a.note.trim()) mapping["note"] = a.note.trim();
    actions[action] = mapping as ActionMapping;
  }

  const manifest: Record<string, unknown> = {
    id: draft.id.trim(),
    label: draft.label.trim(),
    docsUrl: draft.docsUrl.trim(),
    via: draft.via.trim(),
    requiredEnv: draft.requiredEnv.map((e) => e.trim()).filter(Boolean),
    capabilities: draft.capabilities,
    authHeader: draft.authHeader.trim(),
    actions,
  };
  if (draft.kind) manifest["kind"] = draft.kind;
  if (draft.adminOnly) manifest["adminOnly"] = true;
  if (draft.notes.trim()) manifest["notes"] = draft.notes.trim();
  if (draft.credentialType.trim()) manifest["credentialType"] = draft.credentialType.trim();
  if (draft.keyFormat.enabled && draft.keyFormat.scheme) {
    const kf: Record<string, unknown> = { scheme: draft.keyFormat.scheme };
    const env = draft.keyFormat.env.map((e) => e.trim()).filter(Boolean);
    if (env.length) kf["env"] = env;
    if (draft.keyFormat.header.trim()) kf["header"] = draft.keyFormat.header.trim();
    if (draft.keyFormat.pattern.trim()) kf["pattern"] = draft.keyFormat.pattern.trim();
    manifest["keyFormat"] = kf;
  }

  return { manifest, errors };
}

// The embedded schema only checks TYPE for these (a blank string is a valid "string"), so a blank
// required field would otherwise sail through as "valid" — check presence ourselves so the guided
// form actually guides. authHeader isn't in the schema's required[] (a backend with a "none"-scheme
// key genuinely has no per-user header), but the wizard/n8n-generator need SOME value, so it's
// required here too.
const REQUIRED_STRING_FIELDS: Array<"id" | "label" | "docsUrl" | "via"> = ["id", "label", "docsUrl", "via"];

function requiredFieldErrors(manifest: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!String(manifest[field] ?? "").trim()) errors.push(`"${field}" is required`);
  }
  if (!String(manifest["authHeader"] ?? "").trim()) errors.push('"authHeader" is required (the broker expression for the per-user Authorization header)');
  return errors;
}

/** Non-blocking advisories the embedded schema can't express (it always defers pass/fail to it). */
function draftWarnings(draft: BackendDraft): string[] {
  const warnings: string[] = [];
  for (const key of Object.keys(draft.capabilities)) {
    if (draft.capabilities[key] && !(CAPABILITY_DOMAINS as readonly string[]).includes(key)) {
      warnings.push(`"${key}" is not one of the known capability domains — it won't gate any report/view that reads the registry.`);
    }
  }
  if (!CONTRACT_ACTIONS.some((action) => draft.actions[action]?.enabled)) {
    warnings.push("No actions are mapped yet — this backend can't do anything until at least one contract action is wired.");
  }
  const id = draft.id.trim();
  const existing = id ? getBackend(id) : undefined;
  if (existing) {
    warnings.push(`"${id}" matches an existing catalogue backend ("${existing.label}") — placing this file will OVERRIDE it, not add a new one.`);
  }
  return warnings;
}

/** Build the exported JSON and validate it against the SAME schema the config-dir loader
 *  (`registerVendor` → `validateVendor`) and `gen-vendors` enforce, plus a few authoring-time
 *  advisories the schema itself can't express. */
export function evaluateDraft(draft: BackendDraft): DraftEvaluation {
  const { manifest, errors: buildErrors } = buildManifest(draft);
  const errors = [...buildErrors, ...requiredFieldErrors(manifest), ...validateVendor("backends", manifest)];
  const warnings = draftWarnings(draft);
  return { manifest, errors, warnings };
}

/** Trigger a browser download of the built manifest as `<id>.json` (or a placeholder name while the
 *  id is still blank) — the filename the config-dir README requires (filename === id). */
export function downloadBackendManifest(manifest: Record<string, unknown>): void {
  const id = typeof manifest["id"] === "string" && manifest["id"] ? manifest["id"] : "backend";
  downloadJson(manifest, `${id}.json`);
}
