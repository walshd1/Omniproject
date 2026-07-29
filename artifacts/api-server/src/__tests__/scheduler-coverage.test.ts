import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Scheduler-coverage ratchet — the mutation-side of "one scheduler for all background work"
 * (docs/DESIGN-PRINCIPLES §20). This repo has no ESLint, so the rule "recurring JOB work goes through the
 * unified job-scheduler, never a new bespoke `setInterval`" is enforced here, the same idiom as
 * no-unsafe-json-parse.test.ts / write-lane-coverage.test.ts.
 *
 * The rule: the ONLY sanctioned home for a recurring timer that does fleet-once WORK is
 * `lib/job-scheduler.ts` (register a `ScheduledJob` — interval or cron — and it runs claim-once on the shared
 * heartbeat). Every other `setInterval` in server source must be a NON-job timer — a per-replica state
 * convergence poll, a buffer flush, a realtime heartbeat, or a per-connection keepalive — that genuinely must
 * run on every replica and therefore cannot use claim-once scheduling. Each such site is classified in the
 * ALLOWLIST with its reason + expected occurrence COUNT.
 *
 * A NEW file using `setInterval` fails until classified (use the scheduler, or justify the exemption); ADDING a
 * `setInterval` to a listed file bumps its count and also fails until justified. So a new bespoke job-timer
 * can't slip in outside the one scheduler.
 */

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** The sanctioned scheduler home — the single place a work-once recurring timer may live. Exempt from the scan. */
const SCHEDULER_HOME = path.join(SRC, "lib", "job-scheduler.ts");

/** file (relative to src/) → { count, reason } for every NON-job `setInterval` site (can't use claim-once). */
const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  // Per-replica shared-state CONVERGENCE polls — must run on EVERY replica (a break-glass / security control
  // engaged on any replica has to take effect here too), at a ~3s cadence. Claim-once fleet-once scheduling
  // would defeat the point (only one replica would converge), so these are deliberately a different mechanism.
  "lib/ai-kill.ts": { count: 1, reason: "per-replica AI kill-switch convergence poll (must run on every replica; ~3s)" },
  "lib/maintenance.ts": { count: 1, reason: "per-replica maintenance/read-only-lockdown convergence poll (every replica; ~3s)" },
  "lib/security-state.ts": { count: 1, reason: "per-replica AI-authorization convergence poll (every replica; ~3s)" },
  "lib/key-registry.ts": { count: 1, reason: "per-replica key/session-revocation convergence poll (every replica)" },
  "lib/scim.ts": { count: 1, reason: "per-replica SCIM-directory convergence poll (every replica; deprovision must apply fleet-wide)" },
  // Per-replica infra that isn't fleet-once WORK.
  "lib/otlp-metrics.ts": { count: 1, reason: "per-replica OTLP metrics push (each replica exports its OWN metrics)" },
  "lib/audit.ts": { count: 1, reason: "per-replica audit-buffer flush timer (drains this replica's buffer; not a job)" },
  "lib/presence-bus.ts": { count: 1, reason: "per-replica presence heartbeat (realtime roster infra; not a job)" },
  "lib/sse.ts": { count: 1, reason: "per-CONNECTION SSE keepalive ping (one per open stream; not a job)" },
  // Dev/demo convenience — single instance, never production scheduled work.
  "broker/demo.ts": { count: 1, reason: "dev/demo data auto-reset convenience (single instance)" },
};

/** Recursively list every non-test .ts under src/, excluding the scheduler home itself. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...sourceFiles(full)); continue; }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    if (full === SCHEDULER_HOME) continue;
    out.push(full);
  }
  return out;
}

/** Count `setInterval(` occurrences in a file. */
function countSetInterval(file: string): number {
  return (fs.readFileSync(file, "utf8").match(/setInterval\(/g) ?? []).length;
}

test("no unallowlisted setInterval: recurring job work must use the unified job-scheduler", () => {
  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    const n = countSetInterval(file);
    if (n === 0) continue;
    seen.add(rel);
    const allow = ALLOWLIST[rel];
    if (!allow) {
      offenders.push(`${rel}: ${n} setInterval — register a ScheduledJob with lib/job-scheduler.ts (fleet-once work), or classify in ALLOWLIST (per-replica/non-job timer)`);
    } else if (n !== allow.count) {
      offenders.push(`${rel}: setInterval count changed ${allow.count} → ${n} — re-verify each is a non-job timer, then update the count`);
    }
  }
  assert.deepEqual(offenders, [], `Scheduler-coverage gate failed:\n${offenders.join("\n")}`);

  // Keep the allowlist honest: a listed file that no longer uses setInterval must be removed.
  const stale = Object.keys(ALLOWLIST).filter((rel) => !seen.has(rel)).sort();
  assert.deepEqual(stale, [], `Stale ALLOWLIST entries (no setInterval anymore — remove):\n${stale.join("\n")}`);
});
