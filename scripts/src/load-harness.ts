/**
 * n8n load harness — measure the REAL gateway → broker → backend path under
 * concurrency, and report latency percentiles + throughput + error breakdown.
 *
 * The whole point (vs the old read-only stress test): it asks the gateway which
 * broker it is actually talking to and LABELS the result, so demo numbers are
 * never mistaken for n8n-at-scale. It also exercises the WRITE path (the
 * expensive bidirectional n8n hop), which reads alone never measure.
 *
 *   # against a real n8n in queue mode + a real backend (see docs/ops/LOAD-HARNESS.md)
 *   OMNI_API_BASE=https://omni.staging LOAD_COOKIE='omni_session=…' \
 *     LOAD_READS=4000 LOAD_WRITE_CYCLES=200 LOAD_CONCURRENCY=64 \
 *     LOAD_REPORT=./load-report.json pnpm --filter @workspace/scripts run load
 *
 * Tunables (env): LOAD_READS (2000), LOAD_WRITE_CYCLES (0; each = create+update+
 * delete), LOAD_CONCURRENCY (50), LOAD_MAX_ERROR_RATE (0.01), LOAD_MAX_P99_MS
 * (optional budget), LOAD_PROJECT (write target; default first discovered),
 * LOAD_REPORT (write structured JSON here), LOAD_COOKIE / LOAD_API_KEY (auth).
 */

import { writeFileSync } from "node:fs";
import { Recorder, runPool, verdict, classifyStatus, type LoadReport, type Thresholds } from "./lib/load-core";

export {};

const base = process.env["OMNI_API_BASE"] ?? "http://localhost:5000";
const READS = Number(process.env["LOAD_READS"]) || 2000;
const WRITE_CYCLES = Number(process.env["LOAD_WRITE_CYCLES"]) || 0;
const CONCURRENCY = Number(process.env["LOAD_CONCURRENCY"]) || 50;
const MAX_ERROR_RATE = Number(process.env["LOAD_MAX_ERROR_RATE"]) || 0.01;
const MAX_P99 = process.env["LOAD_MAX_P99_MS"] ? Number(process.env["LOAD_MAX_P99_MS"]) : undefined;
const REPORT_PATH = process.env["LOAD_REPORT"];

const c = (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`;
const bold = (s: string) => c(1, s), dim = (s: string) => c(2, s), green = (s: string) => c(32, s);
const red = (s: string) => c(31, s), amber = (s: string) => c(33, s);

let authHeaders: Record<string, string> = {};

async function authenticate(): Promise<void> {
  if (process.env["LOAD_COOKIE"]) { authHeaders = { Cookie: process.env["LOAD_COOKIE"]! }; return; }
  if (process.env["LOAD_API_KEY"]) { authHeaders = { "x-api-key": process.env["LOAD_API_KEY"]! }; return; }
  // Demo fallback: the dev login mints a session cookie.
  const r = await fetch(`${base}/api/auth/login`, { redirect: "manual" }).catch(() => null);
  const sc = r?.headers.get("set-cookie");
  if (sc) authHeaders = { Cookie: sc.split(";")[0]! };
}

async function brokerMode(): Promise<string> {
  const r = await fetch(`${base}/api/capabilities`, { headers: authHeaders }).catch(() => null);
  if (!r || !r.ok) return "unknown";
  const caps = (await r.json().catch(() => ({}))) as { mode?: string };
  return caps.mode ?? "unknown";
}

interface Timed { status: number | null; ms: number }
async function timed(method: string, path: string, body?: unknown): Promise<Timed> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...authHeaders, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ms = Date.now() - t0;
    await r.arrayBuffer(); // drain so sockets free up
    return { status: r.status, ms };
  } catch {
    return { status: null, ms: Date.now() - t0 };
  }
}

async function main(): Promise<void> {
  console.log(bold("OmniProject — n8n load harness"));
  console.log(dim(`target ${base} · ${READS} reads + ${WRITE_CYCLES} write-cycles · concurrency ${CONCURRENCY}`));

  await authenticate();
  const mode = await brokerMode();

  // Honesty banner — the reason this harness exists.
  const measuringN8n = mode === "n8n" || mode === "env";
  if (mode === "demo") {
    console.log(amber(bold("\n⚠ Broker mode is DEMO — these numbers are the in-process demo broker, NOT n8n at scale.")));
    console.log(amber("  Point OMNI_API_BASE at a gateway wired to a real n8n (queue mode) + backend for real figures."));
  } else if (measuringN8n) {
    console.log(green(bold(`\n✓ Broker mode is ${mode.toUpperCase()} — measuring the real gateway → n8n → backend path.`)));
  } else {
    console.log(red(`\n? Broker mode is "${mode}" — could not confirm; treating results as unlabelled.`));
  }

  const projRes = await fetch(`${base}/api/projects`, { headers: authHeaders });
  const projects = (await projRes.json().catch(() => [])) as Array<{ id: string }>;
  if (!Array.isArray(projects) || projects.length === 0) {
    console.error(red("No projects returned — cannot build a workload."));
    process.exit(1);
  }
  const ids = projects.map((p) => p.id);
  const writeProject = process.env["LOAD_PROJECT"] ?? ids[0]!;

  const rec = new Recorder();
  const started = Date.now();

  // Read workload: rotate the three hot read endpoints across the portfolio.
  const readThunks: Array<() => Promise<void>> = [];
  for (let i = 0; i < READS; i++) {
    const pid = ids[i % ids.length]!;
    const pick = ["read:issues", "read:summary", "read:projects"][i % 3]!;
    const path = pick === "read:projects" ? "/api/projects" : `/api/projects/${pid}/${pick === "read:issues" ? "issues" : "summary"}`;
    readThunks.push(async () => { const t = await timed("GET", path); rec.record(pick, t.ms, classifyStatus(t.status)); });
  }

  // Write workload: each cycle creates an issue, updates it, then deletes it —
  // the full bidirectional broker round-trip. Created issues are marked and
  // cleaned up; run only against demo or a disposable staging backend.
  const createdIds: string[] = [];
  const writeThunks: Array<() => Promise<void>> = [];
  for (let i = 0; i < WRITE_CYCLES; i++) {
    writeThunks.push(async () => {
      const cr = await timed("POST", `/api/projects/${writeProject}/issues`, { title: `[load-harness] cycle ${i}` });
      rec.record("write:create", cr.ms, classifyStatus(cr.status));
      let id: string | null = null;
      if (cr.status && cr.status < 300) {
        try {
          const r = await fetch(`${base}/api/projects/${writeProject}/issues`, { headers: authHeaders });
          const list = (await r.json().catch(() => [])) as Array<{ id: string; title?: string }>;
          id = list.find((x) => x.title === `[load-harness] cycle ${i}`)?.id ?? null;
        } catch { /* leave id null */ }
      }
      if (id) {
        const up = await timed("PATCH", `/api/projects/${writeProject}/issues/${id}`, { status: "in_progress" });
        rec.record("write:update", up.ms, classifyStatus(up.status));
        const del = await timed("DELETE", `/api/projects/${writeProject}/issues/${id}`);
        rec.record("write:delete", del.ms, classifyStatus(del.status));
        if (!del.status || del.status >= 300) createdIds.push(id); // needs manual cleanup
      }
    });
  }

  if (WRITE_CYCLES > 0) console.log(dim(`write target project: ${writeProject}`));

  // Interleave so writes contend with reads (realistic mixed load).
  const all = [...readThunks, ...writeThunks].map((t, i) => ({ t, k: (i * 2654435761) >>> 0 }))
    .sort((a, b) => a.k - b.k).map((x) => x.t);
  await runPool(all, CONCURRENCY);

  const elapsed = (Date.now() - started) / 1000;
  const report = rec.report();
  const thresholds: Thresholds = { maxErrorRate: MAX_ERROR_RATE, ...(MAX_P99 != null ? { maxP99Ms: MAX_P99 } : {}) };
  const v = verdict(report, thresholds);
  const throughput = elapsed > 0 ? Math.round(report.total / elapsed) : 0;

  printReport(mode, measuringN8n, report, throughput, elapsed);

  if (REPORT_PATH) {
    const out = {
      tool: "load-harness", target: base, brokerMode: mode,
      measured: measuringN8n ? mode : `UNVERIFIED(${mode})`,
      disclaimer: mode === "demo" ? "Demo broker — NOT representative of n8n at scale." : null,
      concurrency: CONCURRENCY, durationSeconds: Number(elapsed.toFixed(2)), throughputPerSec: throughput,
      thresholds, verdict: v, report,
    };
    writeFileSync(REPORT_PATH, JSON.stringify(out, null, 2));
    console.log(dim(`\nstructured report → ${REPORT_PATH}`));
  }

  if (createdIds.length) console.log(amber(`⚠ ${createdIds.length} load-harness issue(s) could not be deleted — clean up manually: ${createdIds.join(", ")}`));

  if (!v.pass) { console.log(bold(red(`\n✗ FAILED — ${v.reasons.join("; ")}`))); process.exit(1); }
  console.log(bold(green(`\n✓ PASSED — ${report.total} requests, error rate ${(report.overall.errorRate * 100).toFixed(2)}%.`)));
  process.exit(0);
}

function printReport(mode: string, measuringN8n: boolean, report: LoadReport, throughput: number, elapsed: number): void {
  console.log(bold(`\nResults  ${dim(`(broker: ${mode}${measuringN8n ? "" : " — UNLABELLED"})`)}`));
  console.log(`  requests:    ${report.total}   throughput: ${throughput} req/s   duration: ${elapsed.toFixed(2)}s`);
  console.log(`  error rate:  ${(report.overall.errorRate * 100).toFixed(2)}%`);
  console.log(bold("\n  per operation:"));
  console.log(dim("    op                count   p50    p90    p99    max    err"));
  for (const o of report.ops) {
    const l = o.latency;
    const errs = o.categories.client_error + o.categories.server_error + o.categories.network;
    console.log(
      `    ${o.op.padEnd(16)} ${String(l.count).padStart(6)}  ${String(l.p50).padStart(4)}ms ${String(l.p90).padStart(4)}ms ${String(l.p99).padStart(4)}ms ${String(l.max).padStart(4)}ms  ${errs > 0 ? red(String(errs)) : "0"}`,
    );
  }
}

main().catch((err) => { console.error(red("Fatal:"), err); process.exit(1); });
