import fs from "node:fs";

/**
 * Stateful developer mode (opt-in).
 *
 * Demo mode is normally in-memory and resets on restart. Set DEV_PERSIST_FILE to
 * a path and the demo dataset (projects / issues / RAID) is saved on every
 * mutation and reloaded on boot — so a developer can build up test scenarios
 * that survive restarts without wiring n8n or a backend.
 *
 * Dev/test only: in production OmniProject is a stateless overlay and serves
 * real data through n8n; this file store is never used when N8N_WEBHOOK_URL is
 * set. Pure save/load helpers so they're unit-tested.
 */

export interface DemoState {
  projects: unknown[];
  issues: Record<string, unknown[]>;
  raid: Record<string, unknown[]>;
}

export const DEV_PERSIST_FILE = process.env["DEV_PERSIST_FILE"]?.trim() || null;

export function saveState(file: string, state: DemoState): void {
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
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
