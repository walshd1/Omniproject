/**
 * Capture-tape replay CLI (dev-only).
 *
 *   pnpm broker:replay <tape.jsonl>                     # summarise the tape
 *   pnpm broker:replay <tape.jsonl> --serve <method> [jsonArg…]   # serve one recorded call
 *   pnpm broker:replay <tape.jsonl> --redrive [--allow-writes] [--dry-run]
 *
 * `--redrive` re-issues the recorded broker instructions against the LIVE broker
 * the env selects (instance B) and diffs each result against the recording, so you
 * can see where B diverges from where the tape was captured (instance A). Read-only
 * by default — write methods are skipped unless `--allow-writes`; `--dry-run` lists
 * without calling.
 *
 * Refuses to run under NODE_ENV=production (a tape is real activity; this is a dev
 * aid). It is a scripts entry, never an HTTP route.
 */
import { debugAllowed } from "./trace";
import { readTape } from "./capture";
import { buildReplayBroker, redrive } from "./replay";
import type { ActorContext } from "./types";

async function main(): Promise<void> {
  if (!debugAllowed()) {
    console.error("broker:replay is disabled in production (NODE_ENV=production). It is a non-prod developer aid.");
    process.exit(2);
  }
  const argv = process.argv.slice(2);
  const tapePath = argv.find((a) => !a.startsWith("--"));
  if (!tapePath) {
    console.error("usage: pnpm broker:replay <tape.jsonl> [--serve <method> [jsonArg…]] [--redrive [--allow-writes] [--dry-run]]");
    process.exit(2);
  }
  const tape = readTape(tapePath);
  const ctx: ActorContext = { sub: "cli-dev", email: "dev@localhost", name: "CLI Dev", role: "admin" };

  if (argv.includes("--redrive")) {
    const report = await redrive(tape, (await import("./index")).getBroker(), ctx, {
      allowWrites: argv.includes("--allow-writes"),
      dryRun: argv.includes("--dry-run"),
    });
    console.log(`re-drive: ${report.ran} ran, ${report.ok} ok, ${report.diverged} diverged, ${report.failed} failed, ${report.skipped} skipped (of ${report.total})`);
    for (const s of report.steps) {
      const mark = s.status === "ok" ? "✓" : s.status === "diverged" ? "≠" : s.status === "failed" ? "✗" : "·";
      console.log(`  ${mark} #${s.seq} ${s.method}${s.detail ? ` — ${s.detail}` : ""}`);
    }
    if (report.diverged > 0 || report.failed > 0) process.exitCode = 1;
    return;
  }

  const serveIdx = argv.indexOf("--serve");
  if (serveIdx !== -1) {
    const method = argv[serveIdx + 1];
    if (!method) { console.error("--serve needs a method name"); process.exit(2); }
    const rawArgs = argv.slice(serveIdx + 2).filter((a) => !a.startsWith("--"));
    const args = rawArgs.map((r) => JSON.parse(r));
    const broker = buildReplayBroker(tape);
    const fn = (broker as unknown as Record<string, unknown>)[method] as (...a: unknown[]) => Promise<unknown>;
    const out = await fn.apply(broker, [ctx, ...args]);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // Default: summarise the tape.
  const byPlaneMethod = new Map<string, number>();
  for (const ex of tape) {
    const k = `${ex.plane}.${ex.method}`;
    byPlaneMethod.set(k, (byPlaneMethod.get(k) ?? 0) + 1);
  }
  console.log(`tape: ${tape.length} exchanges across ${byPlaneMethod.size} plane.methods`);
  for (const [k, n] of [...byPlaneMethod.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
}

void main();
