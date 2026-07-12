import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { sealConfig, openConfig } from "./config-crypto";

/**
 * On-disk persistence for the in-memory project dataset — TWO opt-in modes, both off by default
 * (the default posture stays a stateless, zero-at-rest overlay):
 *
 *  1. **Stateful DEV mode** (`DEV_PERSIST_FILE`): dev/test convenience — saves the demo dataset in
 *     PLAINTEXT on every mutation and reloads on boot so a developer can build up scenarios that
 *     survive restarts. **Refused in production** (a debugging aid, never a real store).
 *
 *  2. **Built-in backend** (`BUILTIN_BACKEND`): the first-party system-of-record mode (A1). Unlike
 *     dev mode this IS allowed in production, precisely because it is off by default AND
 *     **encrypts at rest** (AES-256-GCM via config-crypto): turning it on is a deliberate, disclosed
 *     choice to let OmniProject *be* a small (encrypted, customer-owned) system of record for a tiny
 *     org with no existing backend — rather than a pure overlay. Seeded EMPTY, never auto-reset.
 *
 * Pure save/load helpers (`encrypt` opt) so they're unit-tested.
 */

export interface DemoState {
  projects: unknown[];
  issues: Record<string, unknown[]>;
  raid: Record<string, unknown[]>;
}

const RAW_FILE = process.env["DEV_PERSIST_FILE"]?.trim() || null;
const IS_PROD = process.env["NODE_ENV"] === "production";

/**
 * Stateful DEV mode is a DEBUGGING aid and is **refused in production** — production must stay a
 * stateless overlay unless the operator opts into the encrypted built-in backend below. If someone
 * sets DEV_PERSIST_FILE in a production build it is ignored (with a loud warning).
 */
export const DEV_PERSIST_ENABLED = !!RAW_FILE && !IS_PROD;
export const DEV_PERSIST_FILE = DEV_PERSIST_ENABLED ? RAW_FILE : null;

if (RAW_FILE && IS_PROD) {
  logger.warn(
    "DEV_PERSIST_FILE is set but NODE_ENV=production — stateful dev mode is IGNORED. " +
      "Stateful mode is for local debugging / issue reproduction only; production is stateless. " +
      "For a persistent first-party store in production, use BUILTIN_BACKEND (encrypted at rest).",
  );
}

/** True when the operator has opted into the encrypted, production-capable built-in backend.
 *  Read live so tests (and a settings toggle) can flip it without a module reload. */
export function builtinBackendEnabled(): boolean {
  const raw = process.env["BUILTIN_BACKEND"]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Where the encrypted built-in dataset lives (a single sealed file). */
export function builtinBackendFile(): string {
  return process.env["BUILTIN_BACKEND_FILE"]?.trim() || path.join("omni-data", "builtin-state.enc");
}

/** Persist the in-memory dataset to disk. `encrypt` seals it at rest (built-in backend); the
 *  dev-mode path writes plaintext. Atomic (temp-file + rename) so a crash can't truncate the file. */
export function saveState(file: string, state: DemoState, opts: { encrypt?: boolean } = {}): void {
  const serialized = JSON.stringify(state, null, 2);
  const payload = opts.encrypt ? sealConfig(serialized) : serialized;
  const dir = path.dirname(file);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, file);
}

/** Load a previously persisted dataset, or null if none / unreadable / (when `encrypt`)
 *  undecryptable — a bad file degrades to "start empty", never a crash. */
export function loadState(file: string, opts: { encrypt?: boolean } = {}): DemoState | null {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    const serialized = opts.encrypt ? openConfig(raw) : raw;
    if (serialized == null) return null; // sealed but undecryptable (wrong/rotated key) → treat as empty
    const parsed = JSON.parse(serialized) as Partial<DemoState>;
    if (!parsed || !Array.isArray(parsed.projects)) return null;
    return {
      projects: parsed.projects,
      issues: parsed.issues && typeof parsed.issues === "object" ? parsed.issues : {},
      raid: parsed.raid && typeof parsed.raid === "object" ? parsed.raid : {},
    };
  } catch {
    return null;
  }
}
