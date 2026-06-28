/**
 * Single-instruction broker CLI — fire ONE broker method through the seam and
 * inspect the exchange, with tracing forced on. A contributor's probe for "what
 * does this one call actually do / return / which path does it take", without
 * standing up the whole app.
 *
 *   pnpm broker:send <method> [jsonArg …] [--twice]
 *
 * Examples:
 *   pnpm broker:send listProjects
 *   pnpm broker:send listIssues '"proj-001"'
 *   pnpm broker:send getIssue '"proj-001"' '"issue-1"' --twice
 *
 * `--twice` sends the SAME instruction twice and diffs the two results, flagging a
 * non-idempotent path (a read should return the same thing both times). It points
 * at whatever broker the env selects — the demo broker by default, or a real
 * backend when BROKER_URL is set — so you can replay a single instruction against
 * either.
 *
 * GATED: refuses to run under NODE_ENV=production (this is a dev aid, and it
 * fabricates an actor context). It is a `scripts`/CLI entry, never an HTTP route,
 * so it adds nothing to the running server's surface.
 */
import { debugAllowed, firstDifference } from "./trace";
import type { ActorContext, Broker } from "./types";

async function main(): Promise<void> {
  if (!debugAllowed()) {
    console.error("broker:send is disabled in production (NODE_ENV=production). It is a non-prod developer aid.");
    process.exit(2);
  }
  // Force method-boundary tracing on for this invocation (before the broker is selected).
  process.env["BROKER_TRACE"] = "1";

  const argv = process.argv.slice(2);
  const twice = argv.includes("--twice");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const method = positional[0];
  if (!method) {
    console.error("usage: pnpm broker:send <method> [jsonArg …] [--twice]");
    process.exit(2);
  }
  const args = positional.slice(1).map((raw, i) => {
    try {
      return JSON.parse(raw);
    } catch {
      console.error(`argument #${i + 1} is not valid JSON: ${raw} (quote strings, e.g. '"proj-001"')`);
      process.exit(2);
    }
  });

  // Import AFTER setting BROKER_TRACE so getBroker() wraps the selected broker.
  const { getBroker } = await import("./index");
  const broker = getBroker();
  const fn = (broker as unknown as Record<string, unknown>)[method];
  if (typeof fn !== "function") {
    console.error(`unknown broker method: ${method}`);
    const names = methodNames(broker);
    console.error(`available: ${names.join(", ")}`);
    process.exit(2);
  }

  const ctx: ActorContext = { sub: "cli-dev", email: "dev@localhost", name: "CLI Dev", role: "admin" };

  const call = () => (fn as (...a: unknown[]) => Promise<unknown>).apply(broker, [ctx, ...args]);
  try {
    const first = await call();
    console.log("\nresult:", JSON.stringify(first, null, 2));
    if (twice) {
      const second = await call();
      const diff = firstDifference(first, second);
      if (diff === null) {
        console.log("\n✓ idempotent: both sends returned identical results.");
      } else {
        console.log(`\n⚠ NON-idempotent: the two sends differ at ${diff}`);
        process.exitCode = 1;
      }
    }
  } catch (err) {
    console.error("\n✗ call failed:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exit(1);
  }
}

/** Best-effort list of callable broker methods (for the error hint). */
function methodNames(broker: Broker): string[] {
  const proto = Object.getPrototypeOf(broker) as object;
  return Object.getOwnPropertyNames(proto)
    .filter((n) => n !== "constructor" && typeof (broker as unknown as Record<string, unknown>)[n] === "function")
    .sort();
}

void main();
