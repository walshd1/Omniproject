/**
 * verify-backend — live flagship-backend certification runner.
 *
 * Drives a catalogued backend's OWN action mappings (the exact templates the
 * generated n8n workflow embeds) against a real, live instance and reports a
 * structured pass/fail per check — the mechanical path to flipping a vendor
 * JSON's `verification` to "verified" and (once the flagship set passes)
 * lifting the catalogue freeze. See docs/VERIFY-BACKENDS.md for the per-backend
 * runbook and scripts/src/lib/backend-freeze.ts for the policy this feeds.
 *
 * Two modes:
 *  - DIRECT  (http-transport backends, e.g. jira/sap): evaluate the manifest's
 *    url/body/auth templates locally and call the vendor API straight.
 *  - WEBHOOK (--webhook <url>; required for native-node backends, e.g.
 *    asana/salesforce/servicenow): drive the IMPORTED generated workflow in a
 *    live n8n through the gateway contract envelope
 *    { action, payload, origin, idempotencyKey } → { success, data, message }.
 *
 * Reads run by default. The write round trip (create → [update] → delete, with
 * cleanup) only runs with --write, and "verified" is only earned with it:
 *
 *   pnpm --filter @workspace/scripts run verify-backend -- --backend jira --write --project ENG [--flip]
 *   pnpm --filter @workspace/scripts run verify-backend -- --backend asana --webhook https://n8n.example/webhook/omni-asana --write --flip
 *
 * Evidence is written to lib/backend-catalogue/vendors/verification/<id>.json
 * (never credentials, never response bodies — statuses and shape notes only).
 * --flip rewrites the vendor JSON's verification to "verified" ONLY when the
 * full read+write round trip passed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { REPO_ROOT } from "./lib/repo-root";
import { evalTemplate, type TemplateContext } from "./lib/n8n-template";
import { green, red, bold, dim } from "./lib/ansi";

export interface ActionMapping {
  kind?: "http" | "n8nNode";
  method?: string;
  url?: string;
  body?: string;
  credentialType?: string;
}
export interface BackendManifest {
  id: string;
  label: string;
  verification: string;
  authHeader?: string;
  credentialType?: string;
  requiredEnv: string[];
  actions: Record<string, ActionMapping | undefined>;
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string | undefined;
}
export interface VerifyOutcome {
  backend: string;
  mode: "direct" | "webhook";
  instanceHost: string | null;
  timestamp: string;
  write: boolean;
  checks: Check[];
  passed: boolean;
}

export interface VerifyOptions {
  write?: boolean | undefined;
  projectId?: string | undefined;
  webhookUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  env?: Record<string, string | undefined> | undefined;
}

const WRITE_PROBE_TITLE = () => `OmniProject verification probe ${new Date().toISOString()}`;

/** Fields a created-record id commonly lives under, across the flagship APIs
 *  (Jira id/key, Asana data.gid, ServiceNow result.sys_id, SAP OData d.*UUID). */
export function extractId(payload: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): string | null => {
    if (!v || typeof v !== "object" || depth > 3 || seen.has(v)) return null;
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const k of ["id", "key", "gid", "sys_id", "ID", "ProjectElementUUID", "ProjectUUID"]) {
      const val = o[k];
      if (typeof val === "string" && val) return val;
      if (typeof val === "number") return String(val);
    }
    for (const k of ["data", "d", "result", "fields"]) {
      const found = walk(o[k], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(payload, 0);
}

/** Best-effort: find the array of records in a list response and return its length, or null. */
export function findCollection(payload: unknown): unknown[] | null {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (!v || typeof v !== "object" || depth > 3 || seen.has(v)) return null;
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const k of ["values", "issues", "data", "results", "result", "d", "elements", "_embedded", "items"]) {
      const found = walk(o[k], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(payload, 0);
}

function ctxFor(env: Record<string, string | undefined>, payload: Record<string, unknown>): TemplateContext {
  return {
    $env: env,
    $json: { body: { action: "", origin: "omniproject", idempotencyKey: crypto.randomUUID(), payload } },
  };
}

interface ActionResult {
  status: number;
  body: unknown;
}

/** DIRECT transport: evaluate the mapping's templates and call the vendor API. */
async function runDirect(
  m: BackendManifest,
  action: string,
  payload: Record<string, unknown>,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
): Promise<ActionResult> {
  const mapping = m.actions[action];
  if (!mapping?.url || (mapping.kind ?? "http") !== "http") throw new Error(`action "${action}" has no http mapping`);
  const ctx = ctxFor(env, payload);
  const url = String(evalTemplate(mapping.url, ctx));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (!mapping.credentialType && !m.credentialType && m.authHeader) {
    headers["Authorization"] = String(evalTemplate(m.authHeader, ctx));
  }
  let body: string | undefined;
  if (mapping.body) {
    const evaluated = evalTemplate(mapping.body, ctx);
    body = typeof evaluated === "string" ? evaluated : JSON.stringify(evaluated);
    headers["Content-Type"] = "application/json";
  }
  if (mapping.method && mapping.method !== "GET") {
    headers["X-OmniProject-Idempotency-Key"] = String(ctx.$json.body["idempotencyKey"]);
  }
  const r = await fetchImpl(url, { method: mapping.method ?? "GET", headers, ...(body !== undefined ? { body } : {}) });
  const text = await r.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: r.status, body: parsed };
}

/** WEBHOOK transport: drive the imported generated workflow with the contract envelope. */
async function runWebhook(
  webhookUrl: string,
  action: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
  extra?: Record<string, unknown>,
): Promise<ActionResult> {
  const r = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload, source: "verify-backend", origin: "omniproject", idempotencyKey: crypto.randomUUID(), ...extra }),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: r.status, body: parsed };
}

/** The broker envelope { success, data } → data (webhook mode); direct mode passes through. */
function unwrap(mode: "direct" | "webhook", body: unknown): unknown {
  if (mode !== "webhook" || !body || typeof body !== "object") return body;
  const o = body as Record<string, unknown>;
  return "data" in o ? o["data"] : body;
}

export async function runVerification(m: BackendManifest, opts: VerifyOptions): Promise<VerifyOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const env = opts.env ?? process.env;
  const mode: "direct" | "webhook" = opts.webhookUrl ? "webhook" : "direct";
  const checks: Check[] = [];
  const outcome: VerifyOutcome = {
    backend: m.id,
    mode,
    instanceHost: null,
    timestamp: new Date().toISOString(),
    write: !!opts.write,
    checks,
    passed: false,
  };

  const act = (action: string, payload: Record<string, unknown>, extra?: Record<string, unknown>): Promise<ActionResult> =>
    mode === "webhook"
      ? runWebhook(opts.webhookUrl!, action, payload, fetchImpl, extra)
      : runDirect(m, action, payload, env, fetchImpl);

  if (mode === "direct") {
    const missing = m.requiredEnv.filter((name) => !env[name]);
    checks.push({
      name: "required env present",
      ok: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(", ")}` : m.requiredEnv.join(", ") || "(none declared)",
    });
    if (missing.length) return outcome;
    const needed = opts.write ? ["list_projects", "list_issues", "create_issue", "delete_issue"] : ["list_projects", "list_issues"];
    const nonHttp = needed.filter((a) => m.actions[a] && (m.actions[a]!.kind ?? "http") !== "http");
    if (nonHttp.length) {
      checks.push({
        name: "direct mode supported",
        ok: false,
        detail: `native-node actions (${nonHttp.join(", ")}) — run through a live n8n with --webhook <url> instead`,
      });
      return outcome;
    }
    const urlTpl = m.actions["list_projects"]?.url;
    if (urlTpl) {
      try {
        outcome.instanceHost = new URL(String(evalTemplate(urlTpl, ctxFor(env, {})))).hostname;
      } catch {
        /* host is informational */
      }
    }
  } else {
    try {
      outcome.instanceHost = new URL(opts.webhookUrl!).hostname;
    } catch {
      checks.push({ name: "webhook URL parses", ok: false, detail: String(opts.webhookUrl) });
      return outcome;
    }
    // Verify short-circuit handshake: proves THIS workflow implements the contract scaffold.
    try {
      const v = await act("get_capabilities", {}, { verify: true });
      const data = unwrap(mode, v.body) as Record<string, unknown> | null;
      const ok = v.status >= 200 && v.status < 300 && !!data && data["verified"] === true && data["backend"] === m.id;
      checks.push({ name: "verify handshake ({ verify: true } ACK)", ok, detail: ok ? undefined : `status ${v.status}, backend ${String(data?.["backend"])}` });
      if (!ok) return outcome;
    } catch (err) {
      checks.push({ name: "verify handshake ({ verify: true } ACK)", ok: false, detail: String(err) });
      return outcome;
    }
  }

  // ── Reads ──────────────────────────────────────────────────────────────────
  let projectId = opts.projectId ?? null;
  try {
    const r = await act("list_projects", {});
    const ok = r.status >= 200 && r.status < 300;
    const coll = findCollection(unwrap(mode, r.body));
    checks.push({
      name: "list_projects → 2xx + collection",
      ok: ok && coll !== null,
      detail: ok ? `status ${r.status}, ${coll ? coll.length : "no"} record(s) found` : `status ${r.status}`,
    });
    if (!projectId && coll?.length) projectId = extractId(coll[0]);
  } catch (err) {
    checks.push({ name: "list_projects → 2xx + collection", ok: false, detail: String(err) });
  }

  if (!projectId) {
    checks.push({ name: "project id available (from --project or list_projects)", ok: false, detail: "pass --project <id|key>" });
    return outcome;
  }

  try {
    const r = await act("list_issues", { projectId });
    const ok = r.status >= 200 && r.status < 300;
    checks.push({ name: "list_issues(projectId) → 2xx", ok, detail: `status ${r.status}` });
  } catch (err) {
    checks.push({ name: "list_issues(projectId) → 2xx", ok: false, detail: String(err) });
  }

  // ── Write round trip (opt-in) ─────────────────────────────────────────────
  if (opts.write) {
    let issueId: string | null = null;
    const title = WRITE_PROBE_TITLE();
    try {
      const r = await act("create_issue", { projectId, title });
      const ok = r.status >= 200 && r.status < 300;
      issueId = ok ? extractId(unwrap(mode, r.body)) : null;
      checks.push({
        name: "create_issue → 2xx + id",
        ok: ok && !!issueId,
        detail: ok ? (issueId ? `status ${r.status}` : `status ${r.status} but no id found in response`) : `status ${r.status}`,
      });
    } catch (err) {
      checks.push({ name: "create_issue → 2xx + id", ok: false, detail: String(err) });
    }
    if (issueId) {
      if (m.actions["update_issue"]) {
        try {
          const r = await act("update_issue", { projectId, issueId, title: `${title} (updated)` });
          const ok = r.status >= 200 && r.status < 300;
          checks.push({ name: "update_issue → 2xx", ok, detail: `status ${r.status}` });
        } catch (err) {
          checks.push({ name: "update_issue → 2xx", ok: false, detail: String(err) });
        }
      }
      try {
        const r = await act("delete_issue", { projectId, issueId });
        const ok = r.status >= 200 && r.status < 300;
        checks.push({
          name: "delete_issue (cleanup) → 2xx",
          ok,
          detail: ok ? `status ${r.status}` : `status ${r.status} — PROBE LEFT BEHIND: "${title}" (${issueId}); delete it manually`,
        });
      } catch (err) {
        checks.push({ name: "delete_issue (cleanup) → 2xx", ok: false, detail: `${String(err)} — PROBE LEFT BEHIND: "${title}" (${issueId})` });
      }
    }
  }

  outcome.passed = checks.every((c) => c.ok);
  return outcome;
}

export const EVIDENCE_DIR = path.join(REPO_ROOT, "lib/backend-catalogue/vendors/verification");

/** Persist the evidence record (statuses + shape notes only — never credentials or bodies). */
export function writeEvidence(outcome: VerifyOutcome, dir: string = EVIDENCE_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${outcome.backend}.json`);
  fs.writeFileSync(file, `${JSON.stringify(outcome, null, 2)}\n`);
  return file;
}

/** Flip the vendor JSON to "verified". Only call after a passed read+write outcome. */
export function flipVerification(backendId: string, rootDir: string = REPO_ROOT): string {
  const file = path.join(rootDir, "lib/backend-catalogue/vendors/backends", `${backendId}.json`);
  const src = fs.readFileSync(file, "utf8");
  const needle = /"verification":\s*"(catalogued|experimental)"/g;
  const hits = src.match(needle);
  if (!hits || hits.length !== 1) throw new Error(`expected exactly one verification field in ${file}, found ${hits?.length ?? 0}`);
  fs.writeFileSync(file, src.replace(needle, '"verification": "verified"'));
  return file;
}

function loadManifest(backendId: string): BackendManifest {
  const file = path.join(REPO_ROOT, "lib/backend-catalogue/vendors/backends", `${backendId}.json`);
  if (!fs.existsSync(file)) throw new Error(`no such backend manifest: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as BackendManifest;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const backendId = arg("backend");
  if (!backendId) {
    console.error("usage: verify-backend -- --backend <id> [--write] [--project <id|key>] [--webhook <url>] [--flip]");
    process.exit(2);
  }
  const m = loadManifest(backendId);
  const write = process.argv.includes("--write");
  const flip = process.argv.includes("--flip");
  const outcome = await runVerification(m, { write, projectId: arg("project"), webhookUrl: arg("webhook") });

  console.log(bold(`\n${m.label} (${m.id}) — ${outcome.mode} mode${outcome.instanceHost ? ` → ${outcome.instanceHost}` : ""}`));
  for (const c of outcome.checks) {
    console.log(`  ${c.ok ? green("PASS") : red("FAIL")} ${c.name}${c.detail ? dim(`  (${c.detail})`) : ""}`);
  }
  const evidence = writeEvidence(outcome);
  console.log(dim(`\nevidence → ${path.relative(REPO_ROOT, evidence)}`));

  if (outcome.passed && write) {
    if (flip) {
      const flipped = flipVerification(m.id);
      console.log(green(`\nverification flipped to "verified" in ${path.relative(REPO_ROOT, flipped)}`));
      console.log("Now regenerate + commit: pnpm --filter @workspace/scripts run gen-vendors && pnpm --filter @workspace/scripts run gen-workflow-blueprints");
    } else {
      console.log(green("\nFull read+write round trip passed — re-run with --flip to mark this backend verified."));
    }
  } else if (outcome.passed) {
    console.log("\nReads passed. \"verified\" needs the write round trip too: re-run with --write (and --flip).");
  } else {
    process.exitCode = 1;
  }
}

// Only run as a CLI (the test imports the functions above).
if (process.argv[1] && /verify-backend\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(red(String(err)));
    process.exit(1);
  });
}
