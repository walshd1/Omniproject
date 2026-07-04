/**
 * Load / stress test — simulate a large portfolio under concurrent users.
 *
 * Start the gateway at demo scale with limits relaxed, then run this:
 *   DEMO_SCALE_PROJECTS=200 RATE_LIMIT_DISABLED=true PORT=5000 \
 *     node artifacts/api-server/dist/index.mjs &
 *   OMNI_API_BASE=http://localhost:5000 STRESS_USERS=2000 \
 *     pnpm --filter @workspace/scripts run stress
 *
 * Tunables: STRESS_USERS (2000), STRESS_REQS (requests/user, 3),
 * STRESS_CONCURRENCY (in-flight, 100), STRESS_MAX_ERROR_RATE (0.01).
 * Reports throughput + p50/p95/p99 latency; fails if the error rate is exceeded.
 */

import { login } from "./lib/demo-session";
import { percentile, runPool } from "./lib/load-core";

export {};

const base = process.env["OMNI_API_BASE"] ?? "http://localhost:5000";
const USERS = Number(process.env["STRESS_USERS"]) || 2000;
const REQS = Number(process.env["STRESS_REQS"]) || 3;
const CONCURRENCY = Number(process.env["STRESS_CONCURRENCY"]) || 100;
const MAX_ERROR_RATE = Number(process.env["STRESS_MAX_ERROR_RATE"]) || 0.01;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  console.log(bold("OmniProject — Stress test"));
  console.log(dim(`target ${base} · ${USERS} users × ${REQS} reqs · concurrency ${CONCURRENCY}`));

  const cookie = await login(base);
  const headers = cookie ? { Cookie: cookie } : {};

  // Discover the portfolio (expects DEMO_SCALE_PROJECTS to be set server-side).
  const projectsRes = await fetch(`${base}/api/projects`, { headers });
  const projects = (await projectsRes.json()) as Array<{ id: string }>;
  if (!Array.isArray(projects) || projects.length === 0) {
    console.error(red("No projects returned — start the server with DEMO_SCALE_PROJECTS=200."));
    process.exit(1);
  }
  console.log(dim(`portfolio: ${projects.length} projects`));

  // Build the request plan: each virtual user runs a short read session.
  const ids = projects.map((p) => p.id);
  const plan: string[] = [];
  for (let u = 0; u < USERS; u++) {
    const pid = ids[u % ids.length];
    const picks = [`/api/projects/${pid}/issues`, `/api/projects/${pid}/summary`, `/api/projects`];
    for (let r = 0; r < REQS; r++) plan.push(picks[r % picks.length]!); // modulo of a non-empty literal array
  }

  const latencies: number[] = [];
  let ok = 0;
  let errors = 0;
  const started = Date.now();

  const thunks = plan.map((reqPath) => async () => {
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}${reqPath}`, { headers });
      const ms = Date.now() - t0;
      latencies.push(ms);
      if (r.status === 200) ok++; else errors++;
      await r.arrayBuffer(); // drain the body so sockets free up
    } catch {
      errors++;
    }
  });

  await runPool(thunks, CONCURRENCY);

  const elapsed = (Date.now() - started) / 1000;
  const total = ok + errors;
  const errorRate = total ? errors / total : 1;
  latencies.sort((a, b) => a - b);

  console.log(bold("\nResults"));
  console.log(`  requests:     ${total}  (ok ${ok}, errors ${errors})`);
  console.log(`  duration:     ${elapsed.toFixed(2)}s`);
  console.log(`  throughput:   ${(total / elapsed).toFixed(0)} req/s`);
  console.log(`  error rate:   ${(errorRate * 100).toFixed(2)}%`);
  console.log(`  latency p50:  ${percentile(latencies, 50)} ms`);
  console.log(`  latency p95:  ${percentile(latencies, 95)} ms`);
  console.log(`  latency p99:  ${percentile(latencies, 99)} ms`);
  console.log(`  latency max:  ${latencies[latencies.length - 1] ?? 0} ms`);

  if (errorRate > MAX_ERROR_RATE) {
    console.log(bold(red(`\n✗ error rate ${(errorRate * 100).toFixed(2)}% exceeds ${(MAX_ERROR_RATE * 100).toFixed(2)}%`)));
    process.exit(1);
  }
  console.log(bold(green(`\n✓ Passed — ${total} requests, error rate ${(errorRate * 100).toFixed(2)}% ≤ ${(MAX_ERROR_RATE * 100).toFixed(2)}%.`)));
  process.exit(0);
}

main().catch((err) => { console.error(red("Fatal:"), err); process.exit(1); });
