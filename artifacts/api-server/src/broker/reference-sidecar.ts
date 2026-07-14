/**
 * Reference HTTP broker sidecar — a RUNNABLE in-memory broker (the CI conformance
 * fixture + author template).
 *
 * Clean separation, same as every other broker here: the binding plumbing
 * (envelope, PSK, verify short-circuit, the action router, the error taxonomy)
 * comes from the shared `processBrokerCall` core — this file is ONLY the in-memory
 * `BrokerBackend` (the store logic) + the Node-HTTP transport glue. A real sidecar
 * swaps `inMemoryBackend` for Postgres/Mongo/etc. and changes nothing else.
 *
 *   1. CI fixture — http-conformance.test.ts runs the conformance suite against it.
 *   2. Author template — `pnpm --filter @workspace/api-server run sidecar`.
 *
 * At massive scale a real (DB-backed) sidecar adds connection pooling, hot-key indexes, keyset
 * pagination, partitioning, materialised rollups, and backpressure — see the "Scaling the sidecar"
 * section of docs/ops/DATABASE-BACKENDS.md. This template models the backpressure half (429 +
 * Retry-After) so the wire contract the gateway backs off on is exercised in CI.
 */
import http from "node:http";
import { sealPayload } from "../lib/broker-psk";
import { signBrokerResponse } from "../lib/broker-hmac";
import { isDone } from "./vocabulary";
import { processBrokerCall, BrokerHttpError, BROKER_PROTOCOL_SUPPORT, type BrokerBackend } from "./reference-broker-blueprint";

type Row = Record<string, unknown>;

interface Store {
  projects: Row[];
  issues: Record<string, Row[]>;
  issueSeq: number;
}

function seed(): Store {
  const now = new Date().toISOString();
  return {
    projects: [
      { id: "proj-ref-1", name: "Reference Project", identifier: "REF", description: "Seeded by the reference sidecar", source: "reference", programmeId: null, programmeName: null, issueCount: 1, completedCount: 0, memberCount: 1, updatedAt: now },
    ],
    issues: {
      "proj-ref-1": [
        { id: "iss-ref-1", projectId: "proj-ref-1", title: "Sample work item", status: "todo", priority: "none", labels: [], source: "reference", version: 1, createdAt: now, updatedAt: now },
      ],
    },
    issueSeq: 1,
  };
}

const CAPABILITIES = {
  issues: true, scheduling: true, resources: true, financials: true, portfolio: true,
  baseline: true, blockers: true, history: true, raid: true, quality: false, crm: false, service: false,
};

/** The in-memory system of record. This is the ONLY broker-specific code — the
 *  binding lives in the shared core. Throw BrokerHttpError to drive the taxonomy. */
function inMemoryBackend(store: Store): BrokerBackend {
  const now = () => new Date().toISOString();
  return {
    async listProjects() { return store.projects; },
    async listIssues(_ctx, projectId) { return store.issues[projectId] ?? []; },
    async getIssue(_ctx, projectId, issueId) { return (store.issues[projectId] ?? []).find((i) => i["id"] === issueId) ?? null; },
    async listProjectMembers() { return [{ id: "u-ref-1", name: "Ada Reference", email: null, access: "write", skills: ["reference"], availableHours: 40, allocatedHours: 20 }]; },
    async listTaskItems() { return []; },
    async projectSummary(_ctx, projectId) {
      const issues = store.issues[projectId] ?? [];
      const completed = issues.filter((i) => isDone(i["status"] as string)).length;
      return { projectId, total: issues.length, completed, overdue: 0, byStatus: {}, completionPct: issues.length ? Math.round((completed / issues.length) * 100) : 0 };
    },
    async projectHistory() { return []; },
    async baseline() { return null; },
    async raid() { return []; },
    async notifications() { return []; },
    async portfolioHealth() { return []; },
    async resourceCapacity() { return []; },
    async projectFinancials(_ctx, projectId) { return { projectId, currency: "GBP", budget: null, actualCost: null, earnedValue: null, committed: null }; },
    async capabilities() { return { ...CAPABILITIES, protocol: BROKER_PROTOCOL_SUPPORT }; },
    async fxRates() { return { base: "GBP", rates: { GBP: 1, USD: 1.27, EUR: 1.17 } }; },
    async replay() { return []; },
    async activity() { return []; },
    async createProject(_ctx, input) {
      const proj = { id: `proj-ref-${store.projects.length + 1}`, name: input["name"], identifier: input["identifier"] ?? "NEW", description: input["description"] ?? null, source: "reference", programmeId: input["programmeId"] ?? null, programmeName: null, issueCount: 0, completedCount: 0, memberCount: 0, updatedAt: now() };
      store.projects.push(proj);
      return proj;
    },
    async updateProject(_ctx, projectId, input) {
      const proj = store.projects.find((p) => p["id"] === projectId);
      if (!proj) throw new BrokerHttpError(404);
      Object.assign(proj, input, { updatedAt: now() });
      return proj;
    },
    async createIssue(_ctx, projectId, input) {
      const issue = { id: `iss-ref-${++store.issueSeq}`, projectId, title: input["title"], status: input["status"] ?? "backlog", priority: input["priority"] ?? "none", labels: input["labels"] ?? [], source: "reference", version: 1, createdAt: now(), updatedAt: now() };
      (store.issues[projectId] ??= []).push(issue);
      return issue;
    },
    async updateIssue(_ctx, projectId, issueId, input) {
      const issue = (store.issues[projectId] ?? []).find((i) => i["id"] === issueId);
      if (!issue) throw new BrokerHttpError(404);
      const expected = input["expectedVersion"];
      if (expected != null && expected !== issue["version"]) throw new BrokerHttpError(409, issue); // current row for the gateway to surface
      const { projectId: _p, issueId: _i, expectedVersion: _v, ...patch } = input;
      Object.assign(issue, patch, { version: (issue["version"] as number) + 1, updatedAt: now() });
      return issue;
    },
    async deleteIssue(_ctx, projectId, issueId) {
      const list = store.issues[projectId] ?? [];
      const idx = list.findIndex((i) => i["id"] === issueId);
      if (idx !== -1) list.splice(idx, 1);
      return null;
    },
    async createRaidEntry(_ctx, projectId, input) {
      return { id: `raid-${Date.now()}`, projectId, ...input, provenance: "sourced", createdAt: now(), updatedAt: now() };
    },
    async createTaskItem(_ctx, _projectId, taskId, input) {
      return { id: `ti-${Date.now()}`, taskId, kind: input["kind"] ?? "note", content: input["content"] ?? "", author: null, createdAt: now() };
    },
  };
}

/**
 * Backpressure options — how the sidecar sheds load at massive scale. A real DB-backed sidecar caps
 * on its connection-pool saturation; here they're simple deterministic knobs that exercise the SAME
 * wire contract (429 + Retry-After) the gateway backs off on:
 *  - `maxInflight`: reject with 429 while more than this many requests are already being processed
 *    (the real "pool is full" signal). 0 ⇒ unlimited (default). Env: SIDECAR_MAX_INFLIGHT.
 *  - `rejectFirst`: reject the first N requests with 429 (deterministic, for tests / demoing backoff).
 */
export interface SidecarOptions { maxInflight?: number; rejectFirst?: number }

/** Emit a 429 with a Retry-After so the gateway honours the backend's backpressure and retries. */
function tooManyRequests(res: http.ServerResponse, retryAfterSec = 0): void {
  res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) });
  res.end(JSON.stringify({ success: false, code: "rate_limited", message: "sidecar is shedding load (backpressure)" }));
}

/** Build (but don't start) the reference sidecar HTTP server — a thin adapter over
 *  the shared core + the in-memory backend, with PSK-symmetric wire encoding. */
export function createReferenceSidecar(opts: SidecarOptions = {}): http.Server {
  const backend = inMemoryBackend(seed());
  const maxInflight = opts.maxInflight ?? (Number(process.env["SIDECAR_MAX_INFLIGHT"]) || 0);
  let rejectFirst = opts.rejectFirst ?? 0;
  let inflight = 0;
  return http.createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    // Backpressure: shed load with 429 + Retry-After (the gateway's callBroker honours it and retries
    // a bounded number of times). A DB-backed sidecar would trip this on pool/queue saturation.
    if (rejectFirst > 0) { rejectFirst--; tooManyRequests(res); return; }
    if (maxInflight > 0 && inflight >= maxInflight) { tooManyRequests(res); return; }
    inflight++;
    res.on("close", () => { inflight--; }); // 'close' fires exactly once per response (success or abort)
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      void processBrokerCall(
        { rawBody: raw, actionHeader: req.headers["x-omniproject-action"] as string | undefined, authHeader: req.headers["authorization"] as string | undefined, headers: req.headers },
        backend,
      ).then((r) => {
        if (res.writableEnded) return; // client disconnected mid-processing — nothing to write
        const text = JSON.stringify(r.body);
        // Reply encrypted when the request was (so the wire stays opaque both ways).
        const wire = r.encrypted ? JSON.stringify({ v: 2, enc: sealPayload(text) }) : text;
        // Sign the reply under the same key the request used, so the gateway can prove the
        // response came from a master-holder and wasn't tampered on the hop.
        const rs = signBrokerResponse(wire, r.bind);
        res.writeHead(r.status, { "Content-Type": "application/json", "X-OmniProject-Origin": "omniproject", "X-Omni-Resp-Sig": rs.sig, "X-Omni-Resp-Ts": String(rs.ts) });
        res.end(wire);
      }).catch(() => { if (!res.writableEnded) res.writeHead(500).end(); }); // never leave a floating rejection
    });
  });
}

// Runnable as a standalone template: `tsx src/broker/reference-sidecar.ts`.
if (process.argv[1]?.endsWith("reference-sidecar.ts")) {
  const port = Number(process.env["PORT"]) || 5701;
  createReferenceSidecar().listen(port, () => console.log(`Reference broker sidecar listening on :${port} (point BROKER_URL here)`));
}
