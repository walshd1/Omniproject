import {
  listProjects,
  listProgrammes,
  getProjectIssues,
  getProjectSummary,
  getProjectCapacity,
  getProjectFinancials,
  getProjectHistory,
  getProjectBaseline,
  getProjectRaid,
  getPortfolioHealth,
  listActivity,
  getCapabilities,
  getListProjectsUrl,
  getListProgrammesUrl,
  getGetProjectIssuesUrl,
  getGetPortfolioHealthUrl,
  getListActivityUrl,
  getGetCapabilitiesUrl,
  type Issue,
  type InterceptedRequest,
  type InterceptResult,
} from "@workspace/api-client-react";
import { triggerBlobDownload } from "./setup";
import { poolMap } from "./concurrency-pool";
import { markExplorationClean } from "./exploration";

/**
 * Explore replica — a captured, deep snapshot of the LIVE read-model that the
 * whole SPA can run against instead of the broker. Capture records every read;
 * in replica mode an interceptor on the api client serves those reads back, and
 * routes edits into a volatile in-session overlay (never written to any backend).
 *
 * This is how /explore "fully replicates live, but with the snapshot as the
 * source of truth": the existing pages/hooks are unchanged — they just resolve
 * against the replica. Everything is client-side and discard-on-close unless you
 * export it. The gateway stays stateless; nothing is persisted server-side.
 */

export const REPLICA_SCHEMA = 1;

export interface ExploreReplica {
  schema: number;
  label: string;
  capturedAt: string;
  /** Recorded GET response bodies, keyed by request path (query stripped). */
  responses: Record<string, unknown>;
}

/** Volatile edits layered over the replica's recorded reads. */
export interface ReplicaOverlay {
  /** New issues created in-session, by projectId. */
  added: Record<string, Issue[]>;
  /** Field patches, by issueId. */
  updated: Record<string, Partial<Issue>>;
  /** Deleted issueIds. */
  deleted: string[];
}

export function newOverlay(): ReplicaOverlay {
  return { added: {}, updated: {}, deleted: [] };
}

/** Apply the volatile overlay to a recorded issue list for one project. */
export function applyIssueOverlay(base: Issue[], overlay: ReplicaOverlay, projectId: string): Issue[] {
  const deleted = new Set(overlay.deleted);
  const out = base
    .filter((i) => !deleted.has(i.id))
    .map((i) => (overlay.updated[i.id] ? { ...i, ...overlay.updated[i.id] } : i));
  for (const added of overlay.added[projectId] ?? []) if (!deleted.has(added.id)) out.push(added);
  return out;
}

function parseBody(body: string | null): Record<string, unknown> {
  if (!body) return {};
  try {
    const v = JSON.parse(body);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function synthIssue(projectId: string, input: Record<string, unknown>): Issue {
  const now = new Date().toISOString();
  const id = `explore-${globalThis.crypto?.randomUUID?.() ?? String(now)}`;
  return {
    ...input,
    id,
    projectId,
    title: String(input.title ?? "Untitled"),
    status: String(input.status ?? "todo"),
    priority: String(input.priority ?? "medium"),
    version: 1,
    createdAt: now,
    updatedAt: now,
  } as unknown as Issue;
}

const ISSUES_COLL = /\/projects\/([^/]+)\/issues$/;
const ISSUE_ITEM = /\/projects\/([^/]+)\/issues\/([^/]+)$/;

/**
 * Resolve a request from the replica + overlay. Reads return recorded bodies
 * (issue lists with the overlay applied); writes mutate the overlay and never
 * hit the network. Pure aside from the in-place overlay mutation that writes
 * require (the overlay IS the session's edit state).
 */
export function resolveReplica(
  replica: ExploreReplica,
  overlay: ReplicaOverlay,
  req: InterceptedRequest,
): InterceptResult {
  const path = req.url.split("?")[0]!; // split always yields ≥1 element
  const method = req.method.toUpperCase();
  const coll = path.match(ISSUES_COLL);
  const item = path.match(ISSUE_ITEM);

  if (method === "GET") {
    if (coll) {
      const pid = decodeURIComponent(coll[1]!); // group 1 present when ISSUES_COLL matches
      const base = (replica.responses[path] as Issue[] | undefined) ?? [];
      return { handled: true, data: applyIssueOverlay(base, overlay, pid) };
    }
    const rec = replica.responses[path];
    return { handled: true, data: rec === undefined ? null : rec };
  }

  if (method === "POST" && coll) {
    const pid = decodeURIComponent(coll[1]!); // group 1 present when ISSUES_COLL matches
    const issue = synthIssue(pid, parseBody(req.body));
    (overlay.added[pid] ??= []).push(issue);
    return { handled: true, data: issue };
  }

  if (item) {
    const pid = decodeURIComponent(item[1]!); // groups 1 & 2 present when ISSUE_ITEM matches
    const issueId = decodeURIComponent(item[2]!);
    if (method === "PATCH") {
      const patch = parseBody(req.body);
      delete patch.expectedVersion;
      overlay.updated[issueId] = { ...(overlay.updated[issueId] ?? {}), ...(patch as Partial<Issue>) };
      const issuesPath = path.replace(/\/[^/]+$/, "");
      const base = (replica.responses[issuesPath] as Issue[] | undefined) ?? [];
      const found = applyIssueOverlay(base, overlay, pid).find((i) => i.id === issueId) ?? null;
      return { handled: true, data: found };
    }
    if (method === "DELETE") {
      if (!overlay.deleted.includes(issueId)) overlay.deleted.push(issueId);
      return { handled: true, data: null };
    }
  }

  // Any other write in replica mode: succeed locally; never touch the network.
  return { handled: true, data: null };
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/** Concurrency bound for the outer per-project loop in captureReplica (each project itself fans
 *  its 7 sub-resource reads out in parallel — see below). See docs/PERF-PATTERNS-REVIEW.md, Theme A. */
const CAPTURE_PROJECT_FANOUT_LIMIT = 8;

/**
 * Capture a deep replica by reading every endpoint live. Per-project analytical
 * sub-resources are best-effort (a backend may not supply them). Runs in LIVE
 * mode (no interceptor installed), so these calls hit the real gateway.
 *
 * The 7 per-project sub-resources are independent reads, so they run via `Promise.all`; the outer
 * loop over all projects is bounded to CAPTURE_PROJECT_FANOUT_LIMIT — was fully serialized
 * (200 × 7 = 1,400 round-trips, ~3 minutes wall-clock), now a bounded parallel fan-out (seconds).
 */
export async function captureReplica(label: string): Promise<ExploreReplica> {
  const responses: Record<string, unknown> = {};
  const record = (path: string, data: unknown) => {
    if (data !== undefined) responses[path] = data;
  };

  const projects = await listProjects();
  record(getListProjectsUrl(), projects);
  record(getListProgrammesUrl(), await safe(() => listProgrammes()));
  record(getGetPortfolioHealthUrl(), await safe(() => getPortfolioHealth()));
  record(getListActivityUrl(), await safe(() => listActivity()));
  record(getGetCapabilitiesUrl(), await safe(() => getCapabilities()));

  await poolMap(projects, CAPTURE_PROJECT_FANOUT_LIMIT, async (p) => {
    const issuesUrl = getGetProjectIssuesUrl(p.id);
    const base = issuesUrl.replace(/\/issues$/, "");
    const [issues, summary, capacity, financials, history, baseline, raid] = await Promise.all([
      safe(() => getProjectIssues(p.id)),
      safe(() => getProjectSummary(p.id)),
      safe(() => getProjectCapacity(p.id)),
      safe(() => getProjectFinancials(p.id)),
      safe(() => getProjectHistory(p.id)),
      safe(() => getProjectBaseline(p.id)),
      safe(() => getProjectRaid(p.id)),
    ]);
    record(issuesUrl, issues);
    record(`${base}/summary`, summary);
    record(`${base}/capacity`, capacity);
    record(`${base}/financials`, financials);
    record(`${base}/history`, history);
    record(`${base}/baseline`, baseline);
    record(`${base}/raid`, raid);
  });

  return { schema: REPLICA_SCHEMA, label, capturedAt: new Date().toISOString(), responses };
}

export function exportReplica(replica: ExploreReplica): void {
  triggerBlobDownload(
    new Blob([JSON.stringify(replica)], { type: "application/json" }),
    `omniproject-replica-${replica.capturedAt.slice(0, 10)}.json`,
  );
  // Downloading is "saving" the exploration — clear the unsaved-work warning, as exportSnapshots/
  // exportEdges do (previously only replica export left the leave-warning stuck on after saving).
  markExplorationClean();
}
