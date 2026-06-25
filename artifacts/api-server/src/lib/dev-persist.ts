import fs from "node:fs";
import { logger } from "./logger";

/**
 * Stateful developer mode (opt-in).
 *
 * Demo mode is normally in-memory and resets on restart. Set DEV_PERSIST_FILE to
 * a path and the demo dataset (projects / issues / RAID) is saved on every
 * mutation and reloaded on boot — so a developer can build up test scenarios
 * that survive restarts without wiring n8n or a backend.
 *
 * Dev/test only: in production OmniProject is a stateless overlay and serves
 * real data through n8n; this file store is never used when BROKER_URL is
 * set. Pure save/load helpers so they're unit-tested.
 */

export interface DemoState {
  projects: unknown[];
  issues: Record<string, unknown[]>;
  raid: Record<string, unknown[]>;
}

const RAW_FILE = process.env["DEV_PERSIST_FILE"]?.trim() || null;
const IS_PROD = process.env["NODE_ENV"] === "production";

/**
 * Stateful mode is a DEBUGGING aid and is **refused in production** — production
 * must stay a stateless overlay over n8n. If someone sets DEV_PERSIST_FILE in a
 * production build it is ignored (with a loud warning) rather than corrupting a
 * stateless deployment.
 */
export const DEV_PERSIST_ENABLED = !!RAW_FILE && !IS_PROD;
export const DEV_PERSIST_FILE = DEV_PERSIST_ENABLED ? RAW_FILE : null;

if (RAW_FILE && IS_PROD) {
  logger.warn(
    "DEV_PERSIST_FILE is set but NODE_ENV=production — stateful dev mode is IGNORED. " +
      "Stateful mode is for local debugging / issue reproduction only; production is stateless.",
  );
}

export function saveState(file: string, state: DemoState): void {
  // Write to a temp file then rename: rename is atomic on the same filesystem, so
  // a crash mid-write can't leave a truncated/half-written file. (A partial JSON
  // would fail to parse on the next boot and silently drop ALL persisted state.)
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

export function loadState(file: string): DemoState | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<DemoState>;
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
