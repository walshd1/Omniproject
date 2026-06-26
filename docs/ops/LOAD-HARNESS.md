# n8n load harness — runbook

**What it is.** A load tool that drives the **real** gateway → broker → backend
path under concurrency and reports latency percentiles, throughput and an error
breakdown. Run it with `pnpm --filter @workspace/scripts run load`.

**Why it exists.** OmniProject had *no measured n8n throughput numbers* — the old
stress test was read-only and ran against the in-process demo broker, so its
figures said nothing about n8n at scale. This harness fixes both gaps:

1. **It labels the broker it measured.** It asks `GET /api/capabilities` for the
   `mode` and stamps the report. A `demo` run is loudly marked
   `measured: "UNVERIFIED(demo)"` with a disclaimer — demo numbers are *never*
   presentable as n8n-at-scale.
2. **It exercises the write path** (create → update → delete), the expensive
   bidirectional n8n hop that reads alone never measure.

The pure core (percentiles, error classification, concurrency pool, verdict) is
unit-tested in `scripts/src/lib/load-core.test.ts`; the CLI is
`scripts/src/load-harness.ts`.

---

## Quick start: the load-test stack

`docker-compose.loadtest.yml` brings up the whole real path — gateway → n8n
(**queue mode**, scalable workers) → OpenProject — so you don't have to assemble
it by hand:

```bash
docker compose -f docker-compose.loadtest.yml up -d
docker compose -f docker-compose.loadtest.yml up -d --scale n8n-worker=4   # add workers
```

(One-time manual step: import the OmniProject n8n blueprint and point it at
OpenProject — documented in the compose header. It's a disposable rig, not a
production deploy.)

### Separating gateway overhead from the broker hop

Every gateway response now carries timing headers, so you can attribute latency:

- `X-Omni-Total-Ms` — total time in the gateway for the request.
- `X-Omni-Upstream-Ms` — of that, time spent waiting on the broker → backend
  (n8n + OpenProject). `total − upstream` ≈ the gateway's own overhead.

A demo-broker response reads `X-Omni-Upstream-Ms: 0` (no upstream hop) — another
way the demo is self-evidently not an n8n measurement.

## Prerequisites for a *real* (n8n) run

The numbers only count when the gateway is wired to a real n8n + backend:

1. **n8n in queue mode** — main + worker(s) + Redis, so it isn't single-process
   bound. (Queue mode is how n8n scales; a single `n8n start` will bottleneck and
   the harness will show it.)
2. **A real backend** behind the workflows (e.g. OpenProject) — or a disposable
   staging instance, **especially for write runs** (writes create and delete
   issues).
3. **The gateway pointed at n8n** — `BROKER_URL` (or `BROKER_URLS` for the
   load-balanced pool) set, so `mode` resolves to `n8n`.
4. **Auth** — a session cookie (`LOAD_COOKIE='omni_session=…'`) or a read API key
   (`LOAD_API_KEY`). Writes need a contributor+ session cookie; a read-only API
   key will (correctly) 403 on writes.

---

## Running it

```bash
# Reads only, against a real n8n-backed gateway:
OMNI_API_BASE=https://omni.staging LOAD_COOKIE='omni_session=…' \
  LOAD_READS=4000 LOAD_CONCURRENCY=64 \
  LOAD_REPORT=./load-report.json \
  pnpm --filter @workspace/scripts run load

# With the write path (DESTRUCTIVE — disposable backend / project only):
… LOAD_WRITE_CYCLES=200 LOAD_PROJECT=<throwaway-project-id> …
```

> **Write safety.** Each write cycle creates an issue titled `[load-harness] …`,
> updates it, then deletes it. Any issue it fails to delete is listed at the end
> for manual cleanup. Do **not** run write cycles against a production backend.

### Tunables (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `OMNI_API_BASE` | `http://localhost:5000` | Gateway base URL |
| `LOAD_READS` | `2000` | Number of read requests |
| `LOAD_WRITE_CYCLES` | `0` | Write cycles (each = create + update + delete) |
| `LOAD_CONCURRENCY` | `50` | Max requests in flight |
| `LOAD_MAX_ERROR_RATE` | `0.01` | Fail the run above this error rate |
| `LOAD_MAX_P99_MS` | — | Optional p99 latency budget (fail if exceeded) |
| `LOAD_PROJECT` | first discovered | Write target project |
| `LOAD_REPORT` | — | Write the structured JSON report here |
| `LOAD_COOKIE` / `LOAD_API_KEY` | — | Auth (cookie preferred for writes) |

---

## Reading the report

Per-operation `p50 / p90 / p99 / max` and an error count, an overall throughput
(req/s) and error rate, and a pass/fail verdict against the thresholds. The JSON
report additionally carries `brokerMode` and `measured` — **trust only runs where
`measured` is `n8n` (or `env`); anything `UNVERIFIED(...)` is not a scale number.**

The harness exits non-zero on failure, so it can gate a staging pipeline.

---

## Measured results

> **Status: not yet measured against a real n8n.** The harness ships; the numbers
> below are placeholders to be filled from a real queue-mode run. Until then, the
> honest position remains: *we have a tool to prove n8n scale, but not yet the
> proof.* (This is the gap the SRE/PMO personas flagged.)

| Date | Broker | Backend | Reads | Write cycles | Concurrency | Throughput | p50 | p99 | Error rate | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _tbd_ | n8n (queue) | OpenProject | | | | | | | | first real run |

(Reference, **not** representative: a demo-broker smoke does ~900 req/s at
concurrency 32 in-process — this measures the gateway + Express, not n8n.)
