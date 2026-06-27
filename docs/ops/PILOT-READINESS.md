# Pilot readiness — observability & the real-backend smoke

The four things that turn "well-built code" into "a pilot you can watch". Each is
wired and tested; this page is how an operator uses them.

---

## 1. Liveness vs readiness (two different probes)

| Probe | Endpoint | Means | On failure |
| --- | --- | --- | --- |
| **Liveness** | `GET /api/healthz` | "the process is alive" — **dependency-free on purpose** | k8s restarts the pod |
| **Readiness** | `GET /api/readyz` | "this replica can reach its backend" — pings the broker (bounded, cached ~5s) | the load balancer stops routing here, **no restart** |

Why the split matters: if liveness depended on the broker, a backend blip would
make k8s **restart every replica at once** — turning a backend outage into a total
outage. Readiness drains traffic from a replica that can't serve, and the pod
recovers on its own when the backend returns. The k8s manifest wires
`readinessProbe → /api/readyz` and `liveness/startup → /api/healthz`.

`/api/readyz` returns `{ ready, kind, status?, detail? }` — `200` when ready, `503`
when the broker is unreachable. The demo/in-process broker is always ready (no
external dependency).

## 2. RED metrics (`GET /api/metrics`, Prometheus)

Always-available, in-process counters — they render **even during a backend
outage** (that's the point), unlike the portfolio gauges which read through to the
backend and degrade gracefully to a comment.

| Metric | Type | Use |
| --- | --- | --- |
| `omniproject_http_requests_total{status}` | counter | **Rate** — `sum(rate(...[5m]))` |
| `omniproject_http_errors_total` | counter | **Errors** — 5xx ratio: `rate(http_errors_total) / rate(http_requests_total)` |
| `omniproject_http_request_duration_ms` | histogram | **Duration** — `histogram_quantile(0.95, ...)` |
| `omniproject_http_in_flight` | gauge | saturation / stuck-request signal |
| `omniproject_broker_requests_total{result}` | counter | broker success/error split |
| `omniproject_broker_request_duration_ms` | histogram | backend latency (separates gateway from backend) |
| `omniproject_unhandled_errors_total` | counter | **real bugs** (5xx reaching the error seam) — alert if this moves |

Scrape with the read-only API token as a Bearer. Multi-replica: each replica
reports its own counters; Prometheus sums across targets (standard model).

**Minimum pilot alerts:** 5xx ratio > 1% for 5m; p95 latency > your SLO;
`unhandled_errors_total` increasing; `readyz` failing.

## 3. Error-capture seam

Every unhandled route error lands in one place (`lib/error-handler.ts`):
fingerprinted (stable 12-char id), structured-logged with request context, counted
in `unhandled_errors_total`, and returned to the client as a **safe generic 500**
(`{ error, reference }`) — never a stack trace. The `reference` matches the log
`fingerprint`, so a user-reported error id leads straight to the log line.
Safe http-errors (413 too-large, 400 malformed JSON) keep their own status; only
status-less bugs become 500s.

## 4. Real-backend smoke test (the highest-value pre-pilot check)

Proves the seam against a **real** backend, not the in-memory reference sidecar —
where auth, field shapes, error codes and latency actually bite. Opt-in; a no-op
skip in CI.

```bash
# Read-only (safe): structural + read conformance against your live broker
SMOKE_BROKER_URL=https://n8n.internal/webhook/omniproject \
SMOKE_AUTH="Bearer $TOKEN" \
pnpm --filter @workspace/api-server smoke

# Also exercise create → update → delete (MUTATES the backend — use a sandbox)
SMOKE_BROKER_URL=... SMOKE_AUTH="Bearer $TOKEN" SMOKE_WRITE=1 \
pnpm --filter @workspace/api-server smoke
```

Run this against a backend **sandbox** before the pilot, then again against the
pilot tenant once provisioned. Green here is the strongest single signal that the
overlay will survive contact with real data.

---

*See also: `MULTI-REPLICA.md` (scale fan-out), `EGRESS-INVENTORY.md` (trust
boundaries), `LOAD-HARNESS.md` (throughput).*
