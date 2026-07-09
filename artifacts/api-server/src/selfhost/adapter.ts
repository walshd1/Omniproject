/**
 * `SelfHostDbAdapter` — the composition-tier **south-seam** façade over the optional self-host
 * database. It is the one place the self-host store plugs into the compositor: a thin, role-tagged
 * `StoreAdapter` that reads/writes ONLY the fields its resolved capability enables, and delegates all
 * actual persistence to an injected `SelfHostDbPort`.
 *
 * The adapter holds NO data and speaks NO SQL — the port does. That keeps this file above the seam
 * (it can be unit-tested with a hand-built port, no Postgres) and lets the real port be the broker's
 * parameterised-SQL workflow (see docs/SELF-HOST-DB.md). The adapter's only job is to enforce the
 * capability: a field the gating hasn't enabled is never read up, never written down.
 */
import type { StoreAdapter, StoreCapability, StoreFragment, StoreRole } from "../composition/types";
import { buildSelfHostCapability, type SelfHostGating, type SelfHostMode } from "./capability-gating";

/**
 * The persistence port the adapter drives. Deliberately minimal + injectable: a `readRows` that
 * returns one raw row per found id and a `writeRow` that upserts a patch. The concrete port is the
 * broker's SQL workflow; tests pass a hand-built double. The adapter — not the port — enforces which
 * fields are in scope, so a port can stay a dumb row store.
 */
export interface SelfHostDbPort {
  /** Return the raw stored row for each id that exists (missing ids simply absent from the map). */
  readRows(entityType: string, ids: readonly string[]): Promise<Record<string, Record<string, unknown>>>;
  /** Upsert a patch of already-capability-filtered fields for one id. */
  writeRow(entityType: string, id: string, fields: Record<string, unknown>): Promise<void>;
}

export interface SelfHostDbAdapterOptions {
  gating: SelfHostGating;
  port: SelfHostDbPort;
  /** Defaults to the gating's mode; pass to override (e.g. force augmenting under a stricter policy). */
  mode?: SelfHostMode;
  storeId?: string;
  /** Optional as-of stamp for time-travel reads, carried into freshness by the compositor. */
  asOf?: string;
}

/** A `StoreAdapter` backed by the self-host DB, enforcing its resolved capability on every field. */
export class SelfHostDbAdapter implements StoreAdapter {
  readonly storeId: string;
  readonly role: StoreRole;
  private readonly cap: StoreCapability;
  private readonly enabledFields: ReadonlySet<string>;
  private readonly storableFields: ReadonlySet<string>;
  private readonly port: SelfHostDbPort;
  private readonly asOfStamp: string | undefined;

  constructor(opts: SelfHostDbAdapterOptions) {
    const mode = opts.mode ?? opts.gating.mode;
    this.storeId = opts.storeId ?? "selfhost";
    this.cap = buildSelfHostCapability(opts.gating, mode, this.storeId);
    this.role = this.cap.role;
    this.enabledFields = new Set(Object.keys(this.cap.fields));
    this.storableFields = new Set(
      Object.entries(this.cap.fields).filter(([, s]) => s.store).map(([k]) => k),
    );
    this.port = opts.port;
    this.asOfStamp = opts.asOf;
  }

  /** The resolved capability (entity-independent for the self-host store — it holds the whole superset). */
  capability(_entityType: string): StoreCapability {
    return this.cap;
  }

  /** Read the ids, keeping only the fields this store's capability surfaces. One fragment per id. */
  async read(entityType: string, ids: string[]): Promise<StoreFragment[]> {
    const rows = await this.port.readRows(entityType, ids);
    return ids.map((id) => {
      const raw = rows[id] ?? {};
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (this.enabledFields.has(k)) values[k] = v;
      }
      return {
        storeId: this.storeId,
        role: this.role,
        ...(this.asOfStamp ? { asOf: this.asOfStamp } : {}),
        values,
      };
    });
  }

  /** Write a patch, dropping any field this store isn't allowed to store; a no-op if nothing remains. */
  async write(entityType: string, id: string, fields: Record<string, unknown>): Promise<void> {
    const allowed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (this.storableFields.has(k)) allowed[k] = v;
    }
    if (Object.keys(allowed).length === 0) return;
    await this.port.writeRow(entityType, id, allowed);
  }

  asOf(): string | undefined {
    return this.asOfStamp;
  }
}
