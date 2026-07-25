import crypto from "node:crypto";
import fs from "node:fs";
import { verifySignature, parsePrivateKey } from "./signing";
import { releasePublicKeyPem, releaseVerifyMode } from "./release-provenance";
import { captureReleaseBackup } from "./release-backup";
import { SealedFile, resolveConfigFile } from "./sealed-file";
import { safeParseJson } from "./safe-json";
import { recordAudit } from "./audit";
import { logger } from "./logger";

/**
 * Signed migration runner (docs/UPDATE-MECHANISM.md §8, phase 6).
 *
 * Data outlives code and new code must read old data (§8: forward-only, additive; unknown-key tolerant). A
 * data-shape change that ISN'T forward-safe is the rare exception, and when it happens it must be:
 *   - EXPLICIT and SIGNED — each migration only runs if it's named in a manifest signed by the SAME release
 *     trust root that signs the image (`RELEASE_PUBLIC_KEY`). An unsigned/tampered/unlisted migration never
 *     runs (fail-closed) — code shipping in the image can't quietly mutate data on its own authority.
 *   - RUN AFTER VERIFY, BEFORE SERVING — at boot, once provenance is verified, before traffic.
 *   - BACKED BY THE §6 SNAPSHOT — a pre-migration backup is captured first, so a bad migration is recoverable.
 *   - REVERSIBLE OR BLOCKING — a pending migration that can't be made forward/backward safe BLOCKS promotion
 *     (`migrationBlockReason`) rather than shipping silently.
 *
 * The transform itself is code (it ships in the image); this binds "which migrations may run, and which have"
 * to a signed manifest + a sealed, audited ledger — the governance around the transform, not the transform.
 */

export class MigrationError extends Error {
  constructor(message: string) { super(message); this.name = "MigrationError"; }
}

export interface Migration {
  /** Stable unique id — the join key across the signed manifest and the applied-ledger. */
  id: string;
  description: string;
  /** True when `down` can cleanly reverse `up` — a pending IRREVERSIBLE migration blocks promotion (§8). */
  reversible: boolean;
  /** Apply the data-shape change. Runs once, at boot, after provenance verify, before serving. */
  up: () => void;
  /** Reverse it (required to be `reversible`). Used by an operator rollback, not run automatically. */
  down?: () => void;
}

const registry: Migration[] = [];

/** Register a migration (at module load). Ids must be unique; a duplicate id is a programming error. */
export function registerMigration(m: Migration): void {
  if (registry.some((r) => r.id === m.id)) throw new MigrationError(`duplicate migration id: ${m.id}`);
  registry.push(m);
}

/** Test seam: drop all registered migrations. */
export function __clearMigrations(): void { registry.length = 0; }

// ── The applied-ledger (sealed at rest) ───────────────────────────────────────────────────────────────
interface LedgerEntry { id: string; at: string }
interface Ledger { applied: LedgerEntry[] }

const ledgerStore = new SealedFile(() => resolveConfigFile("RELEASE_MIGRATION_LEDGER_FILE"), "migration ledger");
let ledger: Ledger = { applied: [] };
let ledgerLoaded = false;

function loadLedger(): void {
  if (ledgerLoaded) return;
  ledgerLoaded = true;
  const raw = ledgerStore.read();
  if (raw === null) return;
  try {
    const p = safeParseJson(raw) as Partial<Ledger>;
    if (p && Array.isArray(p.applied)) ledger = { applied: p.applied.filter((e) => e && typeof e.id === "string") };
  } catch { /* keep the empty ledger on a bad read */ }
}

function recordApplied(id: string, at: string): void {
  ledger.applied.push({ id, at });
  ledgerStore.write(JSON.stringify(ledger));
}

/** The ids of migrations already applied on this deployment. */
export function appliedMigrationIds(): Set<string> {
  loadLedger();
  return new Set(ledger.applied.map((e) => e.id));
}

/** Test seam: clear the in-memory ledger + the loaded-once guard. */
export function __resetMigrationLedger(): void { ledger = { applied: [] }; ledgerLoaded = false; ledgerStore.reset(); }

/** Registered migrations not yet applied, in registration order. */
export function pendingMigrations(): Migration[] {
  const applied = appliedMigrationIds();
  return registry.filter((m) => !applied.has(m.id));
}

/** Pending migrations that are NOT reversible — these block promotion (§8). */
export function pendingIrreversibleMigrations(): Migration[] {
  return pendingMigrations().filter((m) => !m.reversible);
}

/**
 * Why a promotion must be blocked, or null when safe. A pending IRREVERSIBLE migration blocks: shipping new
 * code that will irreversibly reshape data, with no safe rollback, must be a deliberate stop — not a silent
 * side effect of a promote. (Reversible pending migrations don't block: they run at boot and can be undone.)
 */
export function migrationBlockReason(): string | null {
  const irreversible = pendingIrreversibleMigrations();
  if (irreversible.length === 0) return null;
  return `promotion blocked: ${irreversible.length} pending irreversible migration(s) — ${irreversible.map((m) => m.id).join(", ")}`;
}

// ── The signed migration manifest ─────────────────────────────────────────────────────────────────────
export interface SignedMigrationManifest {
  /** The migration ids APPROVED to run for this release. */
  migrations: string[];
  /** base64 Ed25519 signature over {@link canonicalMigrationManifest}. */
  signature: string;
  keyId?: string;
}

/** The canonical message a signature covers: the SORTED, de-duplicated id list as compact JSON — so signing
 *  and verifying are byte-identical regardless of source ordering. */
export function canonicalMigrationManifest(migrations: string[]): string {
  const sorted = [...new Set(migrations)].sort();
  return JSON.stringify({ migrations: sorted });
}

/** Release-side: sign an approved id list with the RELEASE PRIVATE key, producing the manifest the runtime
 *  verifies. Returns null when the key can't be parsed. Signing lives outside the app's mutation path. */
export function buildSignedMigrationManifest(migrations: string[], privateKeyRaw: string): SignedMigrationManifest | null {
  const privateKey = parsePrivateKey(privateKeyRaw);
  if (!privateKey) return null;
  const sorted = [...new Set(migrations)].sort();
  const signature = crypto.sign(null, Buffer.from(canonicalMigrationManifest(sorted)), privateKey).toString("base64");
  return { migrations: sorted, signature };
}

/** Parse an untrusted value into a SignedMigrationManifest, or null when structurally invalid. */
export function parseMigrationManifest(input: unknown): SignedMigrationManifest | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (!Array.isArray(o["migrations"]) || !o["migrations"].every((x) => typeof x === "string")) return null;
  if (typeof o["signature"] !== "string") return null;
  return { migrations: o["migrations"] as string[], signature: o["signature"], ...(typeof o["keyId"] === "string" ? { keyId: o["keyId"] } : {}) };
}

/** Load the signed manifest: inline JSON in `RELEASE_MIGRATIONS`, else the file at `RELEASE_MIGRATIONS_FILE`.
 *  Null when none is present or it's malformed. */
export function loadMigrationManifest(env: NodeJS.ProcessEnv = process.env): SignedMigrationManifest | null {
  const inline = (env["RELEASE_MIGRATIONS"] ?? "").trim();
  if (inline) { try { return parseMigrationManifest(safeParseJson(inline)); } catch { return null; } }
  const file = (env["RELEASE_MIGRATIONS_FILE"] ?? "").trim();
  if (!file) return null;
  try {
    if (!fs.existsSync(file)) return null;
    return parseMigrationManifest(safeParseJson(fs.readFileSync(file, "utf8")));
  } catch { return null; }
}

/** The set of migration ids approved by a VERIFIED signed manifest, or null when unsigned / unverifiable. */
export function approvedMigrationIds(env: NodeJS.ProcessEnv = process.env): Set<string> | null {
  const manifest = loadMigrationManifest(env);
  if (!manifest) return null;
  const pub = releasePublicKeyPem(env);
  if (!pub) return null; // no trust root configured → nothing is approved (fail-closed)
  if (!verifySignature(canonicalMigrationManifest(manifest.migrations), manifest.signature, pub)) return null;
  return new Set(manifest.migrations);
}

export interface MigrationRunResult {
  ran: string[];
  /** Pending migrations NOT run because they weren't in a verified signed manifest (id → reason). */
  refused: Array<{ id: string; reason: string }>;
}

/**
 * Run the pending migrations at boot — each ONLY if it's named in a verified signed manifest. Captures a
 * pre-migration backup first (§6). In `strict` verify mode a pending-but-unapproved migration is fatal
 * (throws — fail-closed boot); in `warn`/`off` it's refused (left pending) and logged. A migration whose
 * `up` throws aborts the run and rethrows — the pre-migration backup enables recovery.
 */
export function runSignedMigrations(env: NodeJS.ProcessEnv = process.env, now: string = new Date().toISOString()): MigrationRunResult {
  const pending = pendingMigrations();
  const result: MigrationRunResult = { ran: [], refused: [] };
  if (pending.length === 0) return result;

  const approved = approvedMigrationIds(env); // null = no verified manifest
  const strict = releaseVerifyMode(env) === "strict";

  // A backup BEFORE any migration touches data — the §6 snapshot the rollback restores.
  captureReleaseBackup(now);

  for (const m of pending) {
    if (!approved || !approved.has(m.id)) {
      const reason = approved ? "not named in the signed migration manifest" : "no verified signed migration manifest present";
      recordAudit({ ts: now, category: "admin", action: "release.migration.refused", write: false, result: "error", meta: { id: m.id, reason } });
      if (strict) throw new MigrationError(`refusing to run migration '${m.id}' at boot: ${reason} (RELEASE_VERIFY=strict)`);
      logger.warn({ id: m.id, reason }, "migration refused — left pending");
      result.refused.push({ id: m.id, reason });
      continue;
    }
    try {
      m.up();
      recordApplied(m.id, now);
      recordAudit({ ts: now, category: "admin", action: "release.migration.applied", write: true, result: "success", meta: { id: m.id, reversible: m.reversible } });
      logger.info({ id: m.id }, "migration applied");
      result.ran.push(m.id);
    } catch (err) {
      recordAudit({ ts: now, category: "admin", action: "release.migration.failed", write: true, result: "error", meta: { id: m.id, error: err instanceof Error ? err.message : String(err) } });
      logger.error({ id: m.id, err }, "migration failed — aborting boot migration run (restore the pre-migration backup to recover)");
      throw err instanceof MigrationError ? err : new MigrationError(`migration '${m.id}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
