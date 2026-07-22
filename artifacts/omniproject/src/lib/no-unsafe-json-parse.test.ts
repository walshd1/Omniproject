import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SPA deserialization-boundary gate — the browser twin of the api-server's no-unsafe-json-parse gate.
 * There is no ESLint here, so the "don't bare-JSON.parse untrusted input" rule is enforced as a test.
 *
 * The rule: outside lib/safe-json.ts, any `JSON.parse(` in SPA source must be TRUSTED input. UNTRUSTED
 * input — localStorage/sessionStorage (another tab or an XSS can poison it), a URL query param, an
 * uploaded file, a cross-peer/replica HTTP body that later gets spread-merged — must go through
 * safeParseJson, which strips __proto__/constructor/prototype at every depth so the result is safe to
 * merge. (Prototype pollution only bites on a later merge; parsing display-only data is lower-risk, but
 * we still prefer the hardened parser at every genuine trust boundary.)
 *
 * ALLOWLIST records every file that still uses bare JSON.parse, why it's trusted, and the expected
 * COUNT. A NEW file using JSON.parse fails until classified; ADDING one to a listed file bumps the count
 * and also fails until justified. So a new untrusted parse can't slip in unreviewed.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** file (relative to src/) → { count, reason } for every TRUSTED bare-JSON.parse site. */
const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  // Server-Sent Events from the app's OWN same-origin gateway (/api/*, withCredentials). Trusted
  // infra, and every parsed payload here is DISPLAYED/fanned-out, never spread-merged into an object.
  "components/NotificationsBell.tsx": { count: 1, reason: "SSE notification from own gateway (/api/notifications/stream), display-only" },
  "components/settings/BrokerLog.tsx": { count: 1, reason: "SSE broker-log entry from own gateway (/api/admin/broker-log/stream), display-only" },
  "lib/live-events.ts": { count: 1, reason: "shared SSE live-event stream from own gateway, fanned out to listeners (not merged)" },
  "lib/presence.ts": { count: 1, reason: "SSE presence stream from own gateway, peers list is display-only" },
  "lib/collab.ts": { count: 1, reason: "SSE co-edit relay frame from own gateway; parse is try/caught and the payload is an opaque base64 Yjs update fed to Y.applyUpdate (CRDT merge, never executed)" },
  "modules/whiteboard/whiteboard-cursors.ts": { count: 1, reason: "SSE cursor frame from own gateway; destructured to primitive from/label/color/msg and rendered as a cursor, never merged" },
  "lib/offline-cache.ts": { count: 1, reason: "decrypted own offline cache — AES-GCM auth tag establishes integrity before parse (decrypt throws → null on tamper); read back as my-work/tasks data, not merged" },
};

/** Recursively list every non-test .ts/.tsx under src/, excluding safe-json.ts itself. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...sourceFiles(full)); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    if (full === path.join(SRC, "lib", "safe-json.ts")) continue;
    out.push(full);
  }
  return out;
}

/** Count `JSON.parse(` occurrences in a file. */
function countJsonParse(file: string): number {
  return (fs.readFileSync(file, "utf8").match(/JSON\.parse\(/g) ?? []).length;
}

describe("SPA deserialization-boundary gate", () => {
  it("has no unallowlisted bare JSON.parse: untrusted deserialization must use safeParseJson", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const n = countJsonParse(file);
      if (n === 0) continue;
      seen.add(rel);
      const allow = ALLOWLIST[rel];
      if (!allow) {
        offenders.push(`${rel}: ${n} bare JSON.parse — classify in ALLOWLIST (trusted) or switch to safeParseJson (untrusted)`);
      } else if (n !== allow.count) {
        offenders.push(`${rel}: JSON.parse count changed ${allow.count} → ${n} — re-verify each is trusted, then update the count`);
      }
    }
    expect(offenders, `Deserialization-boundary gate failed:\n${offenders.join("\n")}`).toEqual([]);

    // Keep the allowlist honest: a listed file that no longer uses JSON.parse must be removed.
    const stale = Object.keys(ALLOWLIST).filter((rel) => !seen.has(rel)).sort();
    expect(stale, `Stale ALLOWLIST entries (no bare JSON.parse anymore — remove):\n${stale.join("\n")}`).toEqual([]);
  });
});
