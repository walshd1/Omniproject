import { canonicalJson } from "./canonical-json";
import { EXCLUDED_KEYS } from "./config-snapshot";
import { splitFullBackup } from "./full-backup";
import type { ArtifactScope } from "./artifact-store";

/**
 * CONFIG DIFF (roadmap §4.9 — sharpen the JSON-config-portability wedge vs SAP CTS/CTS+). Compares two full
 * backups — a baseline (`from`) and a candidate (`to`) — and reports WHAT CHANGED across the settings snapshot
 * and every def-store collection, so an admin can preview a restore/migration, detect drift between two
 * instances, or review a promotion before applying it.
 *
 * CONTENT-FREE by construction: settings diff is at KEY granularity (added/removed/changed — never values), and
 * def/collection diff is by `id` + `rowVersion` only. A secret-bearing settings key is flagged `secret:true` so
 * the UI can say "changed" without ever surfacing the value. The extra sealed stores (ai-providers, rate-card,
 * audit log) are compared only for PRESENCE, never contents. Pure + deterministic (`now` passed in) → unit-tested.
 */

export const CONFIG_DIFF_SCHEMA = "omniproject/config-diff";

export type ChangeStatus = "added" | "removed" | "changed";

export interface SettingsFieldDiff { key: string; status: ChangeStatus; secret: boolean }
export interface CollectionItemDiff { id: string; status: ChangeStatus; fromRowVersion: number | null; toRowVersion: number | null }
export interface CollectionDiff {
  type: string;
  scope: ArtifactScope;
  scopeLabel: string;
  added: number;
  removed: number;
  changed: number;
  items: CollectionItemDiff[];
}
/** Presence-only comparison of the sealed extra stores (their contents are sensitive, never diffed). */
export interface ExtraStoreDiff { name: string; from: boolean; to: boolean }

export interface ConfigDiff {
  schema: typeof CONFIG_DIFF_SCHEMA;
  generatedAt: string;
  settings: { added: string[]; removed: string[]; changed: SettingsFieldDiff[]; unchanged: number };
  defStore: CollectionDiff[];
  extraStores: ExtraStoreDiff[];
  summary: {
    settingsAdded: number; settingsRemoved: number; settingsChanged: number;
    defsAdded: number; defsRemoved: number; defsChanged: number; collectionsChanged: number;
  };
  identical: boolean;
}

type Row = { id: string; rowVersion?: unknown } & Record<string, unknown>;

/** Stable key for a scope (so two collections at the same scope line up regardless of object identity). */
function scopeKey(s: ArtifactScope): string {
  if (s.kind === "user") return `user:${s.sub}`;
  if (s.kind === "project") return `project:${s.projectId}`;
  if (s.kind === "programme") return `programme:${s.programmeId}`;
  return s.kind;
}
function scopeLabel(s: ArtifactScope): string {
  if (s.kind === "user") return `user ${s.sub}`;
  if (s.kind === "project") return `project ${s.projectId}`;
  if (s.kind === "programme") return `programme ${s.programmeId}`;
  return s.kind;
}

/** Pull the inner `Partial<SettingsState>` out of a snapshot half, tolerating a raw settings object too. */
function settingsOf(half: unknown): Record<string, unknown> {
  if (!half || typeof half !== "object") return {};
  const h = half as Record<string, unknown>;
  const inner = "settings" in h && h["settings"] && typeof h["settings"] === "object" ? h["settings"] : h;
  return inner as Record<string, unknown>;
}

function collectionsOf(half: unknown): { type: string; scope: ArtifactScope; items: Row[] }[] {
  if (!half || typeof half !== "object") return [];
  const cols = (half as { collections?: unknown }).collections;
  if (!Array.isArray(cols)) return [];
  return cols.filter((c): c is { type: string; scope: ArtifactScope; items: Row[] } =>
    !!c && typeof c === "object" && typeof (c as { type?: unknown }).type === "string"
    && !!(c as { scope?: unknown }).scope && Array.isArray((c as { items?: unknown }).items));
}

const rowVer = (r: Row): number | null => (typeof r.rowVersion === "number" ? r.rowVersion : null);

/** Diff two full-backup envelopes (already plaintext — the route decrypts a sealed one first). `from` is the
 *  baseline, `to` the candidate. Throws (via splitFullBackup) on a wrong/absent schema. */
export function buildConfigDiff(from: unknown, to: unknown, now: string): ConfigDiff {
  const a = splitFullBackup(from);
  const b = splitFullBackup(to);

  // ── Settings (key-granular, content-free) ──────────────────────────────────────────────────────────────
  const aS = settingsOf(a.settings);
  const bS = settingsOf(b.settings);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: SettingsFieldDiff[] = [];
  let unchanged = 0;
  for (const key of new Set([...Object.keys(aS), ...Object.keys(bS)])) {
    const inA = key in aS;
    const inB = key in bS;
    const secret = EXCLUDED_KEYS.has(key);
    if (inA && !inB) { removed.push(key); changed.push({ key, status: "removed", secret }); }
    else if (!inA && inB) { added.push(key); changed.push({ key, status: "added", secret }); }
    else if (canonicalJson(aS[key] ?? null) !== canonicalJson(bS[key] ?? null)) changed.push({ key, status: "changed", secret });
    else unchanged++;
  }

  // ── Def-store collections (by scope+type, then by id + rowVersion) ─────────────────────────────────────
  const index = (half: unknown): Map<string, { type: string; scope: ArtifactScope; byId: Map<string, Row> }> => {
    const m = new Map<string, { type: string; scope: ArtifactScope; byId: Map<string, Row> }>();
    for (const col of collectionsOf(half)) {
      const k = `${col.type}@${scopeKey(col.scope)}`;
      const byId = new Map<string, Row>();
      for (const it of col.items) if (it && typeof it.id === "string") byId.set(it.id, it);
      m.set(k, { type: col.type, scope: col.scope, byId });
    }
    return m;
  };
  const aCols = index(a.defStore);
  const bCols = index(b.defStore);
  const defStore: CollectionDiff[] = [];
  for (const k of new Set([...aCols.keys(), ...bCols.keys()])) {
    const av = aCols.get(k);
    const bv = bCols.get(k);
    const meta = bv ?? av!; // at least one exists
    const aById = av?.byId ?? new Map<string, Row>();
    const bById = bv?.byId ?? new Map<string, Row>();
    const items: CollectionItemDiff[] = [];
    for (const id of new Set([...aById.keys(), ...bById.keys()])) {
      const ar = aById.get(id);
      const br = bById.get(id);
      if (ar && !br) items.push({ id, status: "removed", fromRowVersion: rowVer(ar), toRowVersion: null });
      else if (!ar && br) items.push({ id, status: "added", fromRowVersion: null, toRowVersion: rowVer(br) });
      else if (ar && br && canonicalJson(ar) !== canonicalJson(br)) items.push({ id, status: "changed", fromRowVersion: rowVer(ar), toRowVersion: rowVer(br) });
    }
    if (items.length === 0) continue; // unchanged collections are omitted
    const addedN = items.filter((i) => i.status === "added").length;
    const removedN = items.filter((i) => i.status === "removed").length;
    const changedN = items.filter((i) => i.status === "changed").length;
    items.sort((x, y) => x.id.localeCompare(y.id));
    defStore.push({ type: meta.type, scope: meta.scope, scopeLabel: scopeLabel(meta.scope), added: addedN, removed: removedN, changed: changedN, items });
  }
  defStore.sort((x, y) => (x.type + x.scopeLabel).localeCompare(y.type + y.scopeLabel));

  // ── Extra sealed stores — presence only (contents are sensitive) ───────────────────────────────────────
  const storesOf = (half: unknown): Record<string, unknown> => {
    const s = (half as { stores?: unknown }).stores;
    return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
  };
  const aStores = storesOf(from);
  const bStores = storesOf(to);
  const extraStores: ExtraStoreDiff[] = ["aiProviders", "rateCard", "auditChain", "auditLog"]
    .map((name) => ({ name, from: aStores[name] !== undefined, to: bStores[name] !== undefined }))
    .filter((d) => d.from || d.to);

  const summary = {
    settingsAdded: added.length,
    settingsRemoved: removed.length,
    settingsChanged: changed.filter((c) => c.status === "changed").length,
    defsAdded: defStore.reduce((n, c) => n + c.added, 0),
    defsRemoved: defStore.reduce((n, c) => n + c.removed, 0),
    defsChanged: defStore.reduce((n, c) => n + c.changed, 0),
    collectionsChanged: defStore.length,
  };
  const identical = changed.length === 0 && defStore.length === 0 && extraStores.every((s) => s.from === s.to);

  return { schema: CONFIG_DIFF_SCHEMA, generatedAt: now, settings: { added, removed, changed, unchanged }, defStore, extraStores, summary, identical };
}
