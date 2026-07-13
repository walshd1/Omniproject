import { safeFetch } from "../egress";
import { logger } from "../logger";
import { lazySingleton } from "../lazy-singleton";
import type { Row } from "../../broker/types";
import type { ProjectReferences } from "../project-forget";

/**
 * The self-managed ARCHIVE store — where a CLOSED project's data goes when the admin/PMO chose the
 * `archive` disposition (vs leaving it in the originating SOR). It's a customer-owned store (reuse the
 * DB **sidecar** / Postgres arch), NOT the gateway: OmniProject stays zero-at-rest for live data and
 * holds only the closed-project INDEX. This seam lets a report retrieve an archived project's snapshot
 * by GUID from its recorded location, closing the loop that planProjectSources plans.
 *
 * Selection mirrors the built-in broker: `ARCHIVE_STORE=sidecar` (+ SQL_SIDECAR_URL) for a durable
 * store, else the in-process memory store (ephemeral — for tests / demo).
 */

/** A point-in-time snapshot captured when a project is archived. */
export interface ArchivedProject {
  guid: string;
  archivedAt: string;
  /** The project row as it was at archive time. */
  project: Row;
  /** Its issues at archive time (empty if none / unavailable). */
  issues: Row[];
  /** Its GTD tasks at archive time (empty when the backend models none). */
  tasks: Row[];
  /** OmniProject's own settings/references for the project — programme memberships, relink aliases,
   *  closed/retired status — captured so the project's configuration is archived alongside its data. */
  settings?: ProjectReferences | undefined;
  note?: string | undefined;
}

/** Lightweight index entry (no payload) — for listing what's archived without pulling every snapshot. */
export interface ArchiveIndexEntry {
  guid: string;
  archivedAt: string;
}

export interface ArchiveStore {
  readonly name: string;
  save(snapshot: ArchivedProject): Promise<void>;
  get(guid: string): Promise<ArchivedProject | null>;
  list(): Promise<ArchiveIndexEntry[]>;
}

/** In-process archive — zero-dependency, non-persistent (tests / ephemeral). */
export class MemoryArchiveStore implements ArchiveStore {
  readonly name = "memory";
  private byGuid = new Map<string, ArchivedProject>();
  async save(snapshot: ArchivedProject): Promise<void> { this.byGuid.set(snapshot.guid, { ...snapshot }); }
  async get(guid: string): Promise<ArchivedProject | null> { const s = this.byGuid.get(guid); return s ? { ...s } : null; }
  async list(): Promise<ArchiveIndexEntry[]> { return [...this.byGuid.values()].map((s) => ({ guid: s.guid, archivedAt: s.archivedAt })); }
}

/** Durable archive over the DB sidecar — one POST per op, same contract as SidecarStore. */
export class SidecarArchiveStore implements ArchiveStore {
  readonly name = "sidecar";
  constructor(private readonly base: string, private readonly token?: string, private readonly timeoutMs = 10_000) {}
  private async call(action: string, payload: unknown): Promise<{ status: number; body: unknown }> {
    const res = await safeFetch(`${this.base.replace(/\/$/, "")}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text().catch(() => "");
    let parsed: unknown = undefined;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
    const body = parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>) ? (parsed as { data: unknown }).data : parsed;
    return { status: res.status, body };
  }
  async save(snapshot: ArchivedProject): Promise<void> {
    const { status } = await this.call("archive_save", snapshot);
    if (status < 200 || status >= 300) throw new Error(`sidecar archive_save failed (${status})`);
  }
  async get(guid: string): Promise<ArchivedProject | null> {
    const { status, body } = await this.call("archive_get", { guid });
    if (status === 404) return null;
    if (status < 200 || status >= 300) throw new Error(`sidecar archive_get failed (${status})`);
    return (body as ArchivedProject) ?? null;
  }
  async list(): Promise<ArchiveIndexEntry[]> {
    const { status, body } = await this.call("archive_list", {});
    if (status < 200 || status >= 300) throw new Error(`sidecar archive_list failed (${status})`);
    return Array.isArray(body) ? (body as ArchiveIndexEntry[]) : [];
  }
}

const SIDECAR_ALIASES = new Set(["sidecar", "sql", "postgres", "postgresql", "mysql", "mssql", "database", "db"]);

/** Build the configured archive store. `ARCHIVE_STORE=sidecar` (+ SQL_SIDECAR_URL) → durable; else
 *  memory. Falls back to memory (with a warning) if a sidecar was asked for but the URL is unset. */
export function selectArchiveStore(): ArchiveStore {
  const requested = process.env["ARCHIVE_STORE"]?.trim().toLowerCase() ?? "";
  if (SIDECAR_ALIASES.has(requested)) {
    const url = process.env["SQL_SIDECAR_URL"]?.trim();
    if (url) return new SidecarArchiveStore(url, process.env["SQL_SIDECAR_TOKEN"]?.trim() || undefined);
    logger.warn({ requested }, `ARCHIVE_STORE="${requested}" needs SQL_SIDECAR_URL — unset, falling back to the NON-PERSISTENT memory archive.`);
  }
  return new MemoryArchiveStore();
}

const storeSingleton = lazySingleton(selectArchiveStore);
/** The process archive store (singleton). */
export function getArchiveStore(): ArchiveStore { return storeSingleton.get(); }
/** Test seam: reset the singleton (and optionally inject a store). */
export function __setArchiveStoreForTest(store: ArchiveStore | null): void { storeSingleton.reset(store); }
