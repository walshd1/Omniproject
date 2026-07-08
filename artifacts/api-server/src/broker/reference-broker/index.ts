import crypto from "node:crypto";
import { getSettings } from "../../lib/settings";
import { configuredBrokerUrl } from "../../lib/broker-url";
import { assertResidency } from "../../lib/data-residency";
import { currentEndpointOverride } from "../endpoint-context";
import { recordAudit } from "../../lib/audit";
import { INDICATIVE_FX_RATES } from "../../lib/fx-fallback";
import { VERIFIABLE_ACTIONS } from "../verifiable-actions";
import { poolMap } from "../../lib/concurrency-pool";
import {
  BrokerError,
  type Broker,
  type ActorContext,
  type Project,
  type Issue,
  type IssueWrite,
  type ProjectWrite,
  type ProjectMember,
  type TaskItem,
  type TaskItemWrite,
  type Summary,
  type HistoryPoint,
  type HistoryState,
  type Baseline,
  type PortfolioRow,
  type FxRates,
  type CapabilityFlags,
  type VerifyReport,
  type Row,
} from "../types";
import { GATEWAY_ORIGIN, REQUEST_HEADERS, type BrokerEnvelope } from "../contract";
import { addUpstreamMs } from "../../lib/request-timing";
import { assertEgressAllowed } from "../../lib/egress";
import { pskEnabled, sealPayload, openPayload, PSK_HEADER, PSK_PREFIX } from "../../lib/broker-psk";
import { signBrokerRequest } from "../../lib/broker-hmac";
import { assertSafeBrokerPayload, assertSafeAuthHeader } from "../../lib/payload-guard";
import { currentTraceparent } from "../../lib/tracing";
import { brokerFetch } from "../../lib/broker-transport";
import { isTimeoutError } from "../../lib/timeout-error";
import type { RequestInit as BrokerRequestInit, Response as BrokerResponse } from "undici";

/**
 * n8n broker — THE one place that knows the broker is n8n.
 *
 * Every n8n-specific detail lives here and nowhere else: the webhook URL, the
 * `{ action, payload, source, origin, idempotencyKey }` envelope + matching
 * `X-OmniProject-*` headers, the per-user-context block for impersonation, the
 * idempotency key, response unwrapping (`{ success, data, message }`), and the
 * upstream→`BrokerError` mapping. Each domain method translates to its n8n
 * action + source label; nothing above the seam ever sees these strings.
 *
 * This module is the sole exception in the architecture guard (docs/BROKER.md).
 */

/**
 * The single broker webhook URL from the environment, via the neutral resolver (which owns the
 * deprecated `N8N_WEBHOOK_URL` alias). `BROKER_URL` is the current, broker-neutral name; the
 * alias is a code-only safety net for pre-0.2.0 deployments.
 */
function brokerUrlFromEnv(): string | undefined {
  return configuredBrokerUrl();
}

/** True when a broker is wired via the environment (selection signal at boot). */
const ENV_WEBHOOK = brokerUrlFromEnv();
export const BROKER_ENV_CONFIGURED = !!ENV_WEBHOOK;

/** The canonical response envelope (see broker/contract.ts). */
type AdapterResult<T = unknown> = BrokerEnvelope<T>;

const DEFAULT_WEBHOOK = "http://localhost:5678/webhook/omniproject";

/** Concurrency bound for the `verify()` probe fan-out over VERIFIABLE_ACTIONS. */
const VERIFY_PROBE_FANOUT_LIMIT = 5;

/**
 * The pool of n8n webhook endpoints. For horizontal scale, set `BROKER_URLS` to a
 * comma-separated list of n8n instances and the adapter load-balances across them
 * (round-robin) with connection-level failover. Otherwise the single
 * settings/env URL is used. Read live so config changes take effect without a
 * restart. This is entirely below the seam — nothing above ReferenceBroker knows.
 */
export function webhookPool(): string[] {
  const pool = resolvePool();
  // Data-residency guard (opt-in, fail-closed): refuse — before any egress — a pool that
  // would route to an endpoint outside the deployment's allowed region(s). No-op when unset.
  assertResidency(pool);
  return pool;
}

function resolvePool(): string[] {
  // A per-kind routing scope (the broker router) overrides the pool for this call —
  // so a command routed to a specific connected broker kind hits that kind's URL.
  const routed = currentEndpointOverride();
  if (routed) return routed;
  const list = process.env["BROKER_URLS"]?.trim();
  if (list) {
    const urls = list.split(",").map((u) => u.trim()).filter(Boolean);
    if (urls.length) return urls;
  }
  return [getSettings().brokerUrl || brokerUrlFromEnv() || DEFAULT_WEBHOOK];
}

let rrCounter = 0;

/** The pool rotated by a round-robin offset, so consecutive calls spread load
 *  and a failed instance is followed by the next one. */
export function orderedTargets(): string[] {
  const pool = webhookPool();
  if (pool.length <= 1) return pool;
  const offset = rrCounter++ % pool.length;
  return [...pool.slice(offset), ...pool.slice(0, offset)];
}

function webhookUrl(): string {
  // The first instance — for single-shot probes (the verifier).
  return webhookPool()[0]!;
}

/**
 * Deterministic idempotency key:
 *   sha256(action + projectId + issueId + timestamp_rounded_to_nearest_minute)
 * Identical actions on the same entity within the same minute collapse to the
 * same key, letting n8n drop duplicate triggers / webhook storms.
 */
export function idempotencyKey(action: string, payload: Record<string, unknown>): string {
  const projectId = String(payload["projectId"] ?? "");
  const issueId = String(payload["issueId"] ?? "");
  const minute = Math.round(Date.now() / 60_000);
  return crypto.createHash("sha256").update(`${action}:${projectId}:${issueId}:${minute}`).digest("hex");
}

/** The backend routing hint sent as the "source" for CRUD/list actions. */
function backendSource(): string {
  return getSettings().backendSource;
}

/** The plaintext envelope callBroker sends (or seals under PSK) + the bookkeeping
 *  (idempotency key, actor) the rest of the call needs. */
interface BuiltEnvelope {
  envelope: { action: string; payload: Record<string, unknown>; source: string; origin: string; idempotencyKey: string };
  actor: { sub: string | undefined; email: string | undefined; name: string | undefined; role: string | undefined; token: string | undefined } | undefined;
  key: string;
  origin: string;
}

/**
 * Step 1: assemble the envelope — origin, idempotency key, the per-user-context
 * block (when `withActor`), and the injection guards. Everything downstream
 * (signing, sending, auditing) is derived from this.
 */
function buildEnvelope(
  action: string,
  payload: Record<string, unknown>,
  opts: { ctx: ActorContext; source: string; withActor: boolean },
): BuiltEnvelope {
  const origin = GATEWAY_ORIGIN;
  const key = idempotencyKey(action, payload);
  const actor = opts.withActor
    ? { sub: opts.ctx.sub, email: opts.ctx.email, name: opts.ctx.name, role: opts.ctx.role, token: opts.ctx.token }
    : undefined;

  const enrichedPayload: Record<string, unknown> = {
    ...payload,
    origin,
    ...(actor ? { userContext: actor } : {}),
  };

  // Injection guard at the egress: no control characters anywhere (CRLF/NUL header &
  // response splitting), and identifier-shaped fields carry no URL-structural characters
  // (so a crafted id can't reshape the backend request path/query). Broker-agnostic
  // defence-in-depth — a hostile value never reaches the backend.
  assertSafeBrokerPayload(enrichedPayload);
  assertSafeAuthHeader(opts.ctx.authHeader);

  // The plaintext request envelope. When PSK is OFF this is the body and the
  // routing details ride in X-OmniProject-* headers + Authorization (TLS is then
  // what protects them on the wire — see lib/broker-psk.ts for the hierarchy).
  const envelope = { action, payload: enrichedPayload, source: opts.source, origin, idempotencyKey: key };
  return { envelope, actor, key, origin };
}

/**
 * Step 2: turn the envelope into a signed, optionally-sealed `RequestInit` —
 * PSK encryption (or plain headers), the detached HMAC signature (+ session
 * binding), and the trace context. `psk` is threaded in (rather than
 * re-read) so the encrypt decision here and the decrypt decision in
 * `unwrapResponse` always agree, even though `pskEnabled()` is just an env read.
 */
function signAndEncrypt(envelope: BuiltEnvelope["envelope"], ctx: ActorContext, psk: boolean): BrokerRequestInit {
  // When PSK is ON, encrypt the WHOLE envelope including the forwarded auth token
  // and send only an opaque ciphertext + a version marker. Nothing sensitive —
  // not the action, the backend source, nor the bearer token — appears in
  // cleartext on the wire, so a packet capture sees ciphertext, not a breach.
  const init: BrokerRequestInit = psk
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json", [PSK_HEADER]: PSK_PREFIX.replace(/\.$/, "") },
        body: JSON.stringify({ v: 1, enc: sealPayload(JSON.stringify({ ...envelope, auth: ctx.authHeader ?? null })) }),
      }
    : {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ctx.authHeader ? { Authorization: ctx.authHeader } : {}),
          [REQUEST_HEADERS.source]: envelope.source,
          [REQUEST_HEADERS.action]: envelope.action,
          [REQUEST_HEADERS.origin]: envelope.origin,
          [REQUEST_HEADERS.idempotencyKey]: envelope.idempotencyKey,
        },
        body: JSON.stringify(envelope),
      };

  // Detached request signature (+ timestamp + nonce): lets a PSK-aware broker refuse
  // REPLAYED or forged requests across untrusted networks. The same keyed MAC underpins
  // the provenance chain. The PSK seal already covers confidentiality + integrity; this
  // adds replay defence and a verifiable signature. Additive headers — a broker that
  // doesn't check them simply ignores them.
  const sig = signBrokerRequest(typeof init.body === "string" ? init.body : "", ctx.sessionBind);
  init.headers = { ...(init.headers as Record<string, string>), "X-Omni-Sig": sig.sig, "X-Omni-Ts": String(sig.ts), "X-Omni-Nonce": sig.nonce };
  // When the signature used a per-session key, ship the (non-secret) binding so the
  // broker re-derives that key from its master and confirms the request came from THIS
  // user's valid session. No binding ⇒ the broker verifies under the static key.
  if (sig.bind) {
    init.headers = {
      ...(init.headers as Record<string, string>),
      "X-Omni-Bind-Sub": sig.bind.sub,
      "X-Omni-Bind-Mono": sig.bind.smono,
      "X-Omni-Bind-Salt": sig.bind.salt,
      "X-Omni-Bind-Kver": String(sig.bind.bkver ?? ""),
    };
  }

  // Forward the W3C trace context so the broker hop joins the same distributed trace.
  const traceparent = currentTraceparent();
  if (traceparent) init.headers = { ...(init.headers as Record<string, string>), traceparent };

  return init;
}

/**
 * Step 3: round-robin across the n8n pool; fail over to the next instance ONLY
 * on a connection-level error (a returned HTTP status is a real response, not
 * an unreachable instance). Each attempt gets a fresh timeout signal.
 */
async function sendWithFailover(init: BrokerRequestInit): Promise<{ res: BrokerResponse | undefined; targets: string[]; lastErr: unknown }> {
  const targets = orderedTargets();
  let res: BrokerResponse | undefined;
  let lastErr: unknown;
  for (const target of targets) {
    try {
      await assertEgressAllowed(target); // SSRF guard: never let the broker URL reach metadata/link-local
      res = await brokerFetch(target, { ...init, signal: AbortSignal.timeout(10_000) });
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  return { res, targets, lastErr };
}

/**
 * Step 4: unwrap the upstream response into the normalized `AdapterResult`,
 * mapping non-2xx / network-level failures onto `BrokerError`, and auditing
 * every outcome via the caller's `audit` closure.
 */
async function unwrapResponse<T>(
  res: BrokerResponse,
  psk: boolean,
  audit: (result: "success" | "error", status: number, extra?: Record<string, unknown>) => void,
): Promise<AdapterResult<T>> {
  try {
    if (!res.ok) {
      // Propagate meaningful upstream codes — notably 409 (optimistic-concurrency
      // conflict) and 404; 5xx collapses to "unavailable". The upstream body is
      // kept for server-side diagnostics (audit meta) only — it is never surfaced
      // to the client, which receives a generic, code-derived message.
      const detail = await res.text().catch(() => "");
      audit("error", res.status, detail ? { upstreamBody: detail.slice(0, 500) } : undefined);
      throw BrokerError.fromStatus(res.status);
    }

    let json = (await res.json().catch(() => ({}))) as unknown;
    // When PSK is on, a conformant broker encrypts its reply the same way; unwrap
    // the `{ v, enc }` envelope back to the plaintext result. A non-encrypted body
    // is left as-is (a broker that doesn't speak PSK simply won't decrypt anyway).
    if (psk && json && typeof json === "object" && typeof (json as { enc?: unknown }).enc === "string") {
      const opened = openPayload((json as { enc: string }).enc);
      json = opened ? (JSON.parse(opened) as unknown) : {};
    }
    const result: AdapterResult<T> =
      json && typeof json === "object" && "success" in json ? (json as AdapterResult<T>) : { success: true, data: json as T };
    audit(result.success === false ? "error" : "success", res.status, result.success === false ? { message: result.message } : undefined);
    return result;
  } catch (err) {
    if (err instanceof BrokerError) throw err;
    const isTimeout = isTimeoutError(err);
    audit("error", 0, { error: err instanceof Error ? err.name : "error" });
    throw new BrokerError("unavailable", isTimeout ? "backend request timed out" : "backend unreachable");
  }
}

/**
 * Forward an action to n8n and return its normalized result. Bare payloads are
 * wrapped so callers always see `{ success, data, message }`. Composes the four
 * steps above in sequence: build the envelope, sign/encrypt it, send it with
 * pool failover, then unwrap the response — auditing every outcome along the way.
 */
async function callBroker<T = unknown>(
  action: string,
  payload: Record<string, unknown>,
  opts: { ctx: ActorContext; source: string; withActor: boolean },
): Promise<AdapterResult<T>> {
  const { envelope, actor, key, origin } = buildEnvelope(action, payload, opts);

  const startedAt = Date.now();
  const audit = (result: "success" | "error", status: number, extra?: Record<string, unknown>) => {
    // Attribute this call's wait to the request's upstream-timing total (no-op
    // outside a request context, e.g. the conformance harness).
    addUpstreamMs(Date.now() - startedAt);
    recordAudit({
      ts: new Date().toISOString(),
      category: "broker",
      action,
      actor: actor ? { sub: actor.sub, email: actor.email, role: actor.role } : null,
      projectId: (payload["projectId"] as string | undefined) ?? null,
      origin,
      write: /^(create|update|delete)_/.test(action),
      result,
      status,
      ms: Date.now() - startedAt,
      meta: { idempotencyKey: key, source: opts.source, ...extra },
    });
  };

  const psk = pskEnabled();
  const init = signAndEncrypt(envelope, opts.ctx, psk);
  const { res, targets, lastErr } = await sendWithFailover(init);

  if (!res) {
    const isTimeout = isTimeoutError(lastErr);
    audit("error", 0, { error: lastErr instanceof Error ? lastErr.name : "error", instancesTried: targets.length });
    throw new BrokerError("unavailable", isTimeout ? "all broker instances timed out" : "all broker instances unreachable");
  }

  return unwrapResponse<T>(res, psk, audit);
}

/**
 * Lightweight readiness probe: is the broker reachable RIGHT NOW? One bounded
 * POST to the first pool endpoint — any HTTP response counts as reachable (we are
 * checking connectivity, not authorisation); only a connection error/timeout is
 * "not ready". Egress-guarded and time-boxed so a readiness check can never hang
 * or be turned into an SSRF. Used by GET /api/readyz.
 */
export async function pingBroker(timeoutMs = 2000): Promise<{ reachable: boolean; status?: number; detail?: string }> {
  const url = webhookPool()[0]!;
  try {
    await assertEgressAllowed(url);
    const res = await brokerFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [REQUEST_HEADERS.action]: "__ready", [REQUEST_HEADERS.origin]: GATEWAY_ORIGIN },
      body: JSON.stringify({ action: "__ready", payload: {}, source: "readiness", origin: GATEWAY_ORIGIN, verify: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { reachable: true, status: res.status };
  } catch (err) {
    const isTimeout = isTimeoutError(err);
    return { reachable: false, detail: isTimeout ? "timed out" : err instanceof Error ? err.name : "unreachable" };
  }
}

// ── Capabilities probe cache (n8n-specific resilience) ──────────────────────────
const CONSERVATIVE: CapabilityFlags = {
  issues: true, scheduling: true, portfolio: true,
  resources: false, financials: false, baseline: false, blockers: false, history: false, raid: false,
  // Superset domains default off — a backend must declare them to light up.
  quality: false, crm: false, service: false,
};
let capCache: { value: CapabilityFlags; at: number } | null = null;
const CAP_TTL_MS = 60_000;

// Indicative FX fallback used when the backend FX read fails (graceful
// degradation in the n8n path). Shared with the demo adapter — single source.
const FALLBACK_FX: FxRates = INDICATIVE_FX_RATES;

/**
 * The one probe both the adapter's `verify()` (VerifyReport, the live broker's
 * self-check) and `POST /setup/verify-workflow` (an admin pointing at a
 * candidate/not-yet-wired webhook URL) run: POST every `VERIFIABLE_ACTIONS`
 * entry as a dry-run (`verify: true`) probe with an 8s timeout, bounded fan-out,
 * and report `{ action, ok, status, ms, verifyAware, message }` for each.
 *
 * PSK-aware: when `BROKER_PSK` is set, probes are sealed the same way a real
 * call would be. This isn't optional here — a PSK-only broker (the honest
 * hierarchy in lib/broker-psk.ts assumes TLS is unavailable on the hop) can't
 * even parse a plaintext probe, so a PSK-blind prober would report every
 * action "unreachable"/failing against a broker that is, in fact, fine. Callers
 * that don't need `verifyAware` (the adapter's `verify()`) just ignore it.
 */
export async function probeVerifiableActions(
  url: string,
  projectId: string,
): Promise<Array<{ action: string; ok: boolean; status: number; ms: number; verifyAware: boolean; message: string | null }>> {
  return poolMap(VERIFIABLE_ACTIONS, VERIFY_PROBE_FANOUT_LIMIT, async (action) => {
    const started = Date.now();
    try {
      await assertEgressAllowed(url); // SSRF guard on the verify probe too
      const probe = { action, payload: { projectId }, source: "verify", origin: GATEWAY_ORIGIN, verify: true };
      const psk = pskEnabled();
      const res = await brokerFetch(url, {
        method: "POST",
        headers: psk
          ? { "Content-Type": "application/json", [PSK_HEADER]: PSK_PREFIX.replace(/\.$/, "") }
          : { "Content-Type": "application/json", "X-OmniProject-Action": action, "X-OmniProject-Origin": GATEWAY_ORIGIN },
        body: psk
          ? JSON.stringify({ v: 1, enc: sealPayload(JSON.stringify(probe)) })
          : JSON.stringify(probe),
        signal: AbortSignal.timeout(8_000),
      });
      let json = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; enc?: string; data?: { verified?: boolean } };
      if (psk && typeof json.enc === "string") {
        const opened = openPayload(json.enc);
        json = opened ? (JSON.parse(opened) as typeof json) : {};
      }
      return {
        action,
        ok: res.ok && json?.success !== false,
        status: res.status,
        ms: Date.now() - started,
        verifyAware: !!json?.data?.verified,
        message: json?.message ?? null,
      };
    } catch (err) {
      const isTimeout = isTimeoutError(err);
      return { action, ok: false, status: 0, ms: Date.now() - started, verifyAware: false, message: isTimeout ? "timed out" : "unreachable" };
    }
  });
}

export class ReferenceBroker implements Broker {
  readonly kind = "n8n";
  readonly live = true;

  async listProjects(ctx: ActorContext): Promise<Project[]> {
    const r = await callBroker<Project[]>("list_projects", {}, { ctx, source: backendSource(), withActor: false });
    return r.data ?? [];
  }

  async listIssues(ctx: ActorContext, projectId: string): Promise<Issue[]> {
    const r = await callBroker<Issue[]>("list_issues", { projectId }, { ctx, source: backendSource(), withActor: false });
    return r.data ?? [];
  }

  async createProject(ctx: ActorContext, input: ProjectWrite): Promise<Project> {
    const r = await callBroker<Project>("create_project", { ...input }, { ctx, source: backendSource(), withActor: true });
    if (!r.data) throw new BrokerError("bad_request", "create_project returned no project");
    return r.data;
  }

  async updateProject(ctx: ActorContext, projectId: string, input: ProjectWrite): Promise<Project> {
    const r = await callBroker<Project>("update_project", { projectId, ...input }, { ctx, source: backendSource(), withActor: true });
    if (!r.data) throw new BrokerError("bad_request", "update_project returned no project");
    return r.data;
  }

  async getIssue(ctx: ActorContext, projectId: string, issueId: string): Promise<Issue | null> {
    const r = await callBroker<Issue | null>("get_issue", { projectId, issueId }, { ctx, source: backendSource(), withActor: false });
    return r.data ?? null;
  }

  async writeIssue(ctx: ActorContext, op: "create" | "update" | "delete", input: IssueWrite): Promise<Issue | null> {
    const action = `${op}_issue`;
    const { projectId, issueId, ...rest } = input;
    const payload: Record<string, unknown> = { projectId, ...(issueId ? { issueId } : {}), ...rest };
    const r = await callBroker<Issue>(action, payload, { ctx, source: backendSource(), withActor: true });
    return op === "delete" ? null : (r.data ?? null);
  }

  async projectMembers(ctx: ActorContext, projectId: string): Promise<ProjectMember[]> {
    const r = await callBroker<ProjectMember[]>("list_project_members", { projectId }, { ctx, source: backendSource(), withActor: false });
    return r.data ?? [];
  }

  async listTaskItems(ctx: ActorContext, projectId: string, taskId: string): Promise<TaskItem[]> {
    const r = await callBroker<TaskItem[]>("list_task_items", { projectId, taskId }, { ctx, source: backendSource(), withActor: false });
    return r.data ?? [];
  }

  async createTaskItem(ctx: ActorContext, projectId: string, taskId: string, input: TaskItemWrite): Promise<TaskItem> {
    const r = await callBroker<TaskItem>("create_task_item", { projectId, taskId, ...input }, { ctx, source: backendSource(), withActor: true });
    if (!r.data) throw new BrokerError("bad_request", "create_task_item returned no item");
    return r.data;
  }

  async listActivity(ctx: ActorContext): Promise<Row[]> {
    const r = await callBroker<Row[]>("list_activity", {}, { ctx, source: backendSource(), withActor: false });
    return r.data ?? [];
  }

  async projectSummary(ctx: ActorContext, projectId: string): Promise<Summary> {
    const r = await callBroker<Summary>("project_summary", { projectId }, { ctx, source: backendSource(), withActor: false });
    // The contract requires a Summary. If the backend returns nothing/non-object,
    // surface it as a backend error (502) rather than emitting `undefined` cast as
    // a Summary, which would crash consumers or render as bogus all-undefined data.
    if (!r.data || typeof r.data !== "object") {
      throw new BrokerError("unavailable", "the backend returned no project summary");
    }
    return { ...r.data, projectId: r.data.projectId ?? projectId };
  }

  async projectHistory(ctx: ActorContext, projectId: string): Promise<HistoryPoint[]> {
    const r = await callBroker<HistoryPoint[]>("get_project_history", { projectId }, { ctx, source: "history_provider", withActor: false });
    return (r.data ?? []).map((p) => ({ ...p, provenance: p.provenance ?? "sourced" }));
  }

  async baseline(ctx: ActorContext, projectId: string): Promise<Baseline | null> {
    const r = await callBroker<Baseline | null>("get_baseline", { projectId }, { ctx, source: "baseline_store", withActor: false });
    return r.data ? { ...r.data, provenance: r.data.provenance ?? "sourced" } : null;
  }

  async listRaid(ctx: ActorContext, projectId: string): Promise<Row[]> {
    const r = await callBroker<Row[]>("get_raid", { projectId }, { ctx, source: "raid_register", withActor: false });
    return (r.data ?? []).map((e) => ({ provenance: "sourced", ...e }));
  }

  async addRaid(ctx: ActorContext, projectId: string, input: Record<string, unknown>): Promise<Row> {
    const r = await callBroker<Row>("create_raid_entry", { projectId, ...input }, { ctx, source: "raid_register", withActor: true });
    return (r.data ?? {}) as Row;
  }

  async notifications(ctx: ActorContext): Promise<Row[]> {
    const r = await callBroker<Row[]>("get_notifications", {}, { ctx, source: "notification_center", withActor: false });
    return r.data ?? [];
  }

  async portfolioHealth(ctx: ActorContext): Promise<PortfolioRow[]> {
    const r = await callBroker<PortfolioRow[]>("get_portfolio_health", {}, { ctx, source: "portfolio_master", withActor: true });
    return r.data ?? [];
  }

  async resourceCapacity(ctx: ActorContext, projectId: string): Promise<Row[]> {
    const r = await callBroker<Row[]>("get_resource_capacity", { projectId }, { ctx, source: "capacity_engine", withActor: true });
    return r.data ?? [];
  }

  async projectFinancials(ctx: ActorContext, projectId: string): Promise<Row> {
    const r = await callBroker<Record<string, unknown>>("get_project_financials", { projectId }, { ctx, source: "financial_ledger", withActor: true });
    return { provenance: "sourced", ...(r.data ?? {}) };
  }

  async capabilities(ctx: ActorContext): Promise<CapabilityFlags> {
    if (capCache && Date.now() - capCache.at < CAP_TTL_MS) return capCache.value;
    try {
      const r = await callBroker<Partial<CapabilityFlags>>("get_capabilities", {}, { ctx, source: "capability_probe", withActor: true });
      const data = r.data;
      const value = (data && typeof data === "object" ? { ...CONSERVATIVE, ...data } : { ...CONSERVATIVE }) as CapabilityFlags;
      capCache = { value, at: Date.now() };
      return value;
    } catch {
      return { ...CONSERVATIVE };
    }
  }

  async fxRates(ctx: ActorContext, opts?: { asOf?: string }): Promise<FxRates> {
    try {
      // `asOf` is a best-effort hint forwarded to the workflow; a workflow that can't resolve a
      // historical rate is free to ignore it and answer with its current spot rate (as ours does).
      const r = await callBroker<Partial<FxRates>>("get_fx_rates", { asOf: opts?.asOf }, { ctx, source: "fx_provider", withActor: false });
      const data = r.data;
      if (data && data.rates && typeof data.rates === "object") {
        return { base: data.base || "GBP", rates: data.rates, provenance: "sourced", asOf: data.asOf || opts?.asOf || new Date().toISOString() };
      }
    } catch {
      /* graceful degradation → indicative rates below */
    }
    return FALLBACK_FX;
  }

  async replay(ctx: ActorContext, opts: { from?: string; to?: string }): Promise<HistoryState[]> {
    const r = await callBroker<HistoryState[]>("replay", { from: opts.from, to: opts.to }, { ctx, source: "history_provider", withActor: false });
    // Recorded states default to `replayed` provenance unless the workflow says otherwise.
    return (r.data ?? []).map((p) => ({ ...p, provenance: p.provenance ?? "replayed" }));
  }

  /**
   * Source-preserving passthrough for the frozen broker-command edge (which carries
   * the caller's `source` label as part of the shipped contract). Not on the
   * Broker interface — `source` is an n8n-envelope concern.
   */
  async commandWithSource(ctx: ActorContext, name: string, payload: Record<string, unknown>, source: string): Promise<unknown> {
    return callBroker(name, payload, { ctx, source, withActor: true });
  }

  async verify(ctx: ActorContext, opts: { projectId?: string } = {}): Promise<VerifyReport> {
    const projectId = opts.projectId ?? "sample";
    const url = webhookUrl();
    const probes = await probeVerifiableActions(url, projectId);
    const actions = probes.map((p) => ({ name: p.action, ok: p.ok, status: p.status, ms: p.ms, note: p.message }));
    return { ok: actions.every((a) => a.ok), actions };
  }
}

/** The n8n adapter exposes its generic command path for the broker-command route. */
export type { AdapterResult };
