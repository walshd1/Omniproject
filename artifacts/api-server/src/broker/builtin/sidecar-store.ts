import { safeFetch } from "../../lib/egress";
import type { Project, Issue, ProjectWrite, IssueWrite, Row, Task, TaskWrite } from "../types";
import type { BuiltinStore } from "./store";

/**
 * SidecarStore — backs the built-in broker with the existing DB **sidecar** vendor (the `sql`
 * backend: PostgreSQL / MySQL / SQL Server), talking to it DIRECTLY over HTTP.
 *
 * This is the "use the Postgres vendor, but with the built-in broker" path: it reuses the sidecar
 * contract (`SQL_SIDECAR_URL` + `SQL_SIDECAR_TOKEN`, per-action endpoints — see
 * docs/ops/DATABASE-BACKENDS.md), so the **gateway stays stateless** (the sidecar holds the DB
 * credentials, not us) and there is **no duplicated SQL** — but it needs NO n8n in front, which is
 * the whole point for a small org. The sidecar owns the schema and the per-action queries.
 *
 * Each `BuiltinStore` op is one POST to `${base}/<action>`; `{ success, data }` envelopes are
 * unwrapped, a bare body is used as-is. Egress-guarded (SSRF), bounded by a timeout.
 */
export class SidecarStore implements BuiltinStore {
  readonly name = "sidecar";
  constructor(private readonly base: string, private readonly token?: string, private readonly timeoutMs = 10_000) {}

  /** POST one action to the sidecar; returns `{ status, body }`. Never throws on a non-2xx (callers
   *  map 404/409 to the store's null/conflict contract) — only a transport failure rejects. */
  private async call(action: string, payload: unknown): Promise<{ status: number; body: unknown }> {
    const res = await safeFetch(`${this.base.replace(/\/$/, "")}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text().catch(() => "");
    let parsed: unknown = undefined;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
    // Unwrap a `{ success, data, message }` envelope; else use the body verbatim.
    const body = parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>) ? (parsed as { data: unknown }).data : parsed;
    return { status: res.status, body };
  }

  /** Call and require a 2xx, throwing otherwise (for ops with no null/conflict branch). */
  private async ok<T>(action: string, payload: unknown): Promise<T> {
    const { status, body } = await this.call(action, payload);
    if (status < 200 || status >= 300) throw new Error(`sidecar ${action} failed (${status})`);
    return body as T;
  }

  async listProjects(): Promise<Project[]> {
    const rows = await this.ok<Project[]>("list_projects", {});
    return Array.isArray(rows) ? rows : [];
  }
  async getProject(id: string): Promise<Project | null> {
    const { status, body } = await this.call("get_project", { id });
    if (status === 404) return null;
    return (body as Project) ?? null;
  }
  async createProject(input: ProjectWrite): Promise<Project> {
    return this.ok<Project>("create_project", input);
  }
  async updateProject(id: string, input: ProjectWrite): Promise<Project | null> {
    const { status, body } = await this.call("update_project", { id, ...input });
    if (status === 404) return null;
    if (status < 200 || status >= 300) throw new Error(`sidecar update_project failed (${status})`);
    return body as Project;
  }

  async listIssues(projectId: string): Promise<Issue[]> {
    const rows = await this.ok<Issue[]>("list_issues", { projectId });
    return Array.isArray(rows) ? rows : [];
  }
  async getIssue(projectId: string, issueId: string): Promise<Issue | null> {
    const { status, body } = await this.call("get_issue", { projectId, issueId });
    if (status === 404) return null;
    return (body as Issue) ?? null;
  }
  async createIssue(input: IssueWrite): Promise<Issue> {
    return this.ok<Issue>("create_issue", input);
  }
  async updateIssue(input: IssueWrite): Promise<Issue | { conflict: number } | null> {
    const { status, body } = await this.call("update_issue", input);
    if (status === 404) return null;
    // Optimistic concurrency: the sidecar returns 409 with the current row (or its version).
    if (status === 409) {
      const version = body && typeof body === "object" ? Number((body as Row)["version"] ?? 0) : 0;
      return { conflict: version };
    }
    if (status < 200 || status >= 300) throw new Error(`sidecar update_issue failed (${status})`);
    return body as Issue;
  }
  async deleteIssue(projectId: string, issueId: string): Promise<boolean> {
    const { status } = await this.call("delete_issue", { projectId, issueId });
    if (status === 404) return false;
    if (status < 200 || status >= 300) throw new Error(`sidecar delete_issue failed (${status})`);
    return true;
  }

  async listRaid(projectId: string): Promise<Row[]> {
    const rows = await this.ok<Row[]>("list_raid", { projectId });
    return Array.isArray(rows) ? rows : [];
  }
  async addRaid(projectId: string, entry: Record<string, unknown>): Promise<Row> {
    return this.ok<Row>("add_raid", { projectId, ...entry });
  }

  async listTasks(opts: { projectId?: string }): Promise<Task[]> {
    const rows = await this.ok<Task[]>("list_tasks", opts.projectId ? { projectId: opts.projectId } : {});
    return Array.isArray(rows) ? rows : [];
  }
  async getTask(taskId: string): Promise<Task | null> {
    const { status, body } = await this.call("get_task", { taskId });
    if (status === 404) return null;
    return (body as Task) ?? null;
  }
  async createTask(input: TaskWrite): Promise<Task> {
    return this.ok<Task>("create_task", input);
  }
  async updateTask(taskId: string, input: TaskWrite): Promise<Task | null> {
    const { status, body } = await this.call("update_task", { taskId, ...input });
    if (status === 404) return null;
    if (status < 200 || status >= 300) throw new Error(`sidecar update_task failed (${status})`);
    return body as Task;
  }
}
