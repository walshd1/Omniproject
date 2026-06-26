/**
 * Reference HTTP broker sidecar — the minimal, in-memory implementation of the
 * broker HTTP binding (docs/BROKER-HTTP-BINDING.md).
 *
 * Two jobs:
 *   1. **CI fixture** — the conformance suite runs against it over real HTTP
 *      (http-conformance.test.ts), proving the seam works for ANY out-of-process
 *      broker, not just the in-process demo. This is the scaffolding that makes a
 *      DB-backed sidecar (RFC-003) a drop-in: point BROKER_URL at a service that
 *      passes conformance and the core needs zero changes.
 *   2. **Author template** — `pnpm --filter @workspace/api-server run sidecar`
 *      starts it; a real sidecar swaps the in-memory store for Postgres/Mongo/etc.
 *
 * It speaks exactly the binding: POST `{action, payload, …}` → `{success, data}`,
 * HTTP status codes for the error taxonomy, optimistic concurrency via 409.
 */
import http from "node:http";

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

/** Dispatch one binding action against the store. Throws `{status}` to map onto
 *  the error taxonomy; returns the normalised `data` otherwise. */
function dispatch(store: Store, action: string, payload: Row): unknown {
  const pid = String(payload["projectId"] ?? "");
  const now = new Date().toISOString();
  switch (action) {
    case "list_projects": return store.projects;
    case "list_issues": return store.issues[pid] ?? [];
    case "get_issue": return (store.issues[pid] ?? []).find((i) => i["id"] === payload["issueId"]) ?? null;
    case "list_project_members": return [{ id: "u-ref-1", name: "Ada Reference", email: null, access: "write", skills: ["reference"], availableHours: 40, allocatedHours: 20 }];
    case "list_task_items": return [];
    case "project_summary": {
      const issues = store.issues[pid] ?? [];
      const completed = issues.filter((i) => i["status"] === "done").length;
      return { projectId: pid, total: issues.length, completed, overdue: 0, byStatus: {}, completionPct: issues.length ? Math.round((completed / issues.length) * 100) : 0 };
    }
    case "get_project_history": return [];
    case "get_baseline": return null;
    case "get_raid": return [];
    case "create_raid_entry": return { id: `raid-${Date.now()}`, projectId: pid, ...payload, provenance: "sourced", createdAt: now, updatedAt: now };
    case "get_notifications": return [];
    case "get_portfolio_health": return [];
    case "get_resource_capacity": return [];
    case "get_project_financials": return { projectId: pid, currency: "GBP", budget: null, actualCost: null, earnedValue: null, committed: null };
    case "get_capabilities": return CAPABILITIES;
    case "get_fx_rates": return { base: "GBP", rates: { GBP: 1, USD: 1.27, EUR: 1.17 } };
    case "replay": return [];
    case "list_activity": return [];
    case "create_project": {
      const proj = { id: `proj-ref-${store.projects.length + 1}`, name: payload["name"], identifier: payload["identifier"] ?? "NEW", description: payload["description"] ?? null, source: "reference", programmeId: payload["programmeId"] ?? null, programmeName: null, issueCount: 0, completedCount: 0, memberCount: 0, updatedAt: now };
      store.projects.push(proj);
      return proj;
    }
    case "update_project": {
      const proj = store.projects.find((p) => p["id"] === pid);
      if (!proj) throw { status: 404 };
      Object.assign(proj, payload, { updatedAt: now });
      return proj;
    }
    case "create_issue": {
      const issue = { id: `iss-ref-${++store.issueSeq}`, projectId: pid, title: payload["title"], status: payload["status"] ?? "backlog", priority: payload["priority"] ?? "none", labels: payload["labels"] ?? [], source: "reference", version: 1, createdAt: now, updatedAt: now };
      (store.issues[pid] ??= []).push(issue);
      return issue;
    }
    case "update_issue": {
      const issue = (store.issues[pid] ?? []).find((i) => i["id"] === payload["issueId"]);
      if (!issue) throw { status: 404 };
      const expected = payload["expectedVersion"];
      if (expected != null && expected !== issue["version"]) throw { status: 409, body: issue };
      const { projectId: _p, issueId: _i, expectedVersion: _v, ...patch } = payload;
      Object.assign(issue, patch, { version: (issue["version"] as number) + 1, updatedAt: now });
      return issue;
    }
    case "delete_issue": {
      const list = store.issues[pid] ?? [];
      const idx = list.findIndex((i) => i["id"] === payload["issueId"]);
      if (idx !== -1) list.splice(idx, 1);
      return null;
    }
    case "create_task_item": return { id: `ti-${Date.now()}`, taskId: payload["taskId"], kind: payload["kind"] ?? "note", content: payload["content"] ?? "", author: null, createdAt: now };
    default:
      // Verify probes and any unrecognised action: a healthy no-op success.
      return null;
  }
}

/** Build (but don't start) the reference sidecar HTTP server. */
export function createReferenceSidecar(): http.Server {
  const store = seed();
  return http.createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body: Row = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { res.writeHead(400).end(); return; }
      const action = String((req.headers["x-omniproject-action"] as string) || body["action"] || "");
      const payload = (body["payload"] as Row) ?? {};
      try {
        const data = dispatch(store, action, payload);
        res.writeHead(200, { "Content-Type": "application/json", "X-OmniProject-Origin": "omniproject" });
        res.end(JSON.stringify({ success: true, data, message: null }));
      } catch (e) {
        const err = e as { status?: number; body?: unknown };
        res.writeHead(err.status ?? 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify(err.body ?? { success: false, message: "error" }));
      }
    });
  });
}

// Runnable as a standalone template: `tsx src/broker/reference-sidecar.ts`.
if (process.argv[1]?.endsWith("reference-sidecar.ts")) {
  const port = Number(process.env["PORT"]) || 5701;
  createReferenceSidecar().listen(port, () => console.log(`Reference broker sidecar listening on :${port} (point BROKER_URL here)`));
}
