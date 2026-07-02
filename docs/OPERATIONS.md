# Operations: scaling, HA, DR & telemetry

OmniProject's gateway (the **omni-shell**) is a **stateless PM/PgM overlay**: it serves the SPA +
API and brokers every read/write to your backend over `BROKER_URL`. It holds **no project data at
rest** — the backend (n8n / your system of record) is the source of truth. That single property is
what makes scaling, HA and DR simple: you scale and recover the *process*, and back up only a small
amount of *config*.

This guide covers running it in production:

- [Scaling](#scaling)
- [High availability (HA)](#high-availability-ha)
- [Disaster recovery (DR) & backup](#disaster-recovery-dr--backup)
- [Enabling telemetry (OTLP metrics + traces)](#enabling-telemetry-otlp-metrics--traces)

Deployment artifacts: the **Helm chart** lives at [`deploy/helm/omniproject`](../deploy/helm/omniproject),
and a flat all-in-one manifest at [`k8s-enterprise-manifest.yaml`](../k8s-enterprise-manifest.yaml).
For Docker Compose see [`DEPLOY-LOCAL.md`](./DEPLOY-LOCAL.md); for autoscaling background see
[`SCALING.md`](./SCALING.md).

---

## Scaling

The shell scales **horizontally** — add replicas, put them behind the Service/Ingress, let the load
balancer fan out. Because it is stateless, every replica is interchangeable and a request can land on
any of them.

### Install the chart

```bash
helm upgrade --install omni deploy/helm/omniproject \
  --namespace omniproject --create-namespace \
  --set image.repository=your-registry/omniproject-shell \
  --set image.tag=0.6.0 \
  --set config.BROKER_URL=http://n8n:5678/webhook/omniproject \
  --set config.PUBLIC_URL=https://app.your-domain.com

# Provide secrets out-of-band (do NOT inline real values in values.yaml):
kubectl -n omniproject create secret generic omni-omniproject-secrets \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=OIDC_ISSUER_URL=https://your-idp/... \
  --from-literal=OIDC_CLIENT_ID=... --from-literal=OIDC_CLIENT_SECRET=...
# ...or reference it: --set secret.create=false --set secret.existingSecret=omni-omniproject-secrets
```

### Autoscaling (HPA)

The chart ships a `HorizontalPodAutoscaler`, **disabled by default**. Enable it once the real-time
bus is in place (see the caveat below):

```yaml
# values.yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 6
  targetCPUUtilizationPercentage: 70
config:
  REDIS_URL: "redis://redis:6379"   # REQUIRED before >1 replica
```

Sizing rule of thumb: the shell is I/O-bound (it forwards to the broker), so it needs little CPU/RAM
(defaults request `100m` / `256Mi`, limit `500m` / `512Mi`). Scale on CPU first; add a memory target
only if you enable the read cache with a large working set.

### ⚠️ The one caveat: real-time fan-out needs a shared bus

Live notifications and presence use an **in-process** SSE fan-out. With **>1 replica and no shared
bus**, a client connected to replica A never sees an event emitted on replica B — roughly half of
real-time notifications are dropped. Everything else (all REST reads/writes) is already replica-safe.

**Before scaling past 1 replica, set `config.REDIS_URL`** so the fan-out and presence run over a shared
Redis bus (`lib/broker-log-bus.ts`, `lib/redis-bus.ts`). The chart's `NOTES.txt` prints a warning if it
detects `replicas > 1` (or the HPA enabled) without `REDIS_URL`.

---

## High availability (HA)

Stateless ⇒ HA is "run more than one, spread them out, and let readiness route around failure".

1. **Multiple replicas across nodes/zones.** Set `replicaCount: 3` (or the HPA), plus:

   ```yaml
   topologySpreadConstraints:
     - maxSkew: 1
       topologyKey: topology.kubernetes.io/zone
       whenUnsatisfiable: ScheduleAnyway
       labelSelector:
         matchLabels:
           app.kubernetes.io/name: omniproject
   podDisruptionBudget:
     enabled: true
     minAvailable: 1
   ```

   The PDB keeps a rolling node drain / cluster upgrade from taking all replicas at once.

2. **Readiness gates traffic, liveness restarts the process — deliberately different probes.**
   - `GET /api/healthz` (**liveness**) is dependency-free: it answers 200 whenever the process is
     alive. It does **not** touch the broker, so a backend blip can't trigger a restart storm.
   - `GET /api/readyz` (**readiness**) returns **503 when the broker is unreachable**, so the Service
     stops routing to a replica that can't serve — **without** restarting it. When the backend
     recovers, readiness flips back to 200 and traffic returns.

3. **Graceful shutdown / zero-downtime rollouts.** On `SIGTERM` (rolling deploy, node drain) the shell
   drains in-flight requests and live SSE streams before exiting (`lib/shutdown.ts`), so a
   `RollingUpdate` doesn't cut active requests.

4. **Backend + broker HA is separate.** The shell's availability during a backend outage is "serve
   cached/health signals and fail readiness"; true end-to-end HA also needs your **backend** (n8n on
   PostgreSQL, not sqlite) and any Redis bus to be HA. n8n with sqlite is single-instance — use
   PostgreSQL for a multi-replica broker.

---

## Disaster recovery (DR) & backup

Because the overlay is **config-only with zero project data at rest**, DR is fast and the backup
surface is tiny.

### What to back up

| Item | Where | Notes |
| --- | --- | --- |
| Chart values / release config | your GitOps repo | `values.yaml` + `--set` overrides. Treat as code. |
| Kubernetes `Secret` | out-of-band store | SESSION_SECRET, OIDC creds, API_TOKENS, VAULT_KEY. Manage with **External Secrets Operator** or **Sealed Secrets**, not raw manifests. |
| Config directory (`OMNI_CONFIG_DIR`) | PVC snapshot / object store | Only if you use the **local** vault/settings store (`persistence.enabled`). Contains the sealed AI-key vault + operator settings — **encrypted at rest**. Optional: use an external vault (`vault-aws.ts` / `vault-azure.ts`) and skip the PVC. |
| **Project data** | **your backend** | Not OmniProject's to back up — it lives in n8n/your system of record. Back the backend up on its own schedule. |

### Zero-at-rest posture

The shell stores **no** project/portfolio data on disk. The only optional local state is the config
directory, and everything sensitive in it (the AI-key vault) is **encrypted** under a KMS-wrapped or
`SESSION_SECRET`-derived key. Lose a replica's disk and you lose nothing that isn't reproducible from
config + the backend.

### Recovery (RTO/RPO)

- **RPO ≈ 0 for project data** — it never lived in the shell; it's whatever your backend's RPO is.
- **RTO = time to redeploy the chart** — re-apply the release, restore the Secret (and the config PVC
  if used), point `BROKER_URL` at the recovered backend. No data migration, no warm-up.

```bash
# Rebuild the overlay in a fresh cluster/region:
kubectl create namespace omniproject
kubectl -n omniproject apply -f your-sealed-secret.yaml      # or External Secrets
helm upgrade --install omni deploy/helm/omniproject -n omniproject -f values.yaml
```

### Fail-fast safety net

The gateway **refuses to boot** in production with an unset/empty/default `SESSION_SECRET` — so a
botched restore that forgets the Secret fails loudly at startup instead of silently signing sessions
with a public key.

---

## Enabling telemetry (OTLP metrics + traces)

Observability is **additive and off by default**. Two signals are **always on** with no configuration:

- **W3C trace context** — every request continues/starts a trace, echoes `traceparent` +
  `x-request-id`, and correlates log lines to the trace (`lib/tracing.ts`).
- **Prometheus scrape** — `GET /api/metrics` always serves RED metrics (request rate, errors,
  latency histograms), in-flight depth, broker-call latency, **cache hit/miss**, and portfolio
  gauges. These are pure in-process counters, so they keep reporting even when the backend is down.

  Scrape it with a read-only API token:

  ```yaml
  # Prometheus scrape_config
  - job_name: omniproject
    metrics_path: /api/metrics
    authorization: { credentials: "<read-only API_TOKEN>" }
    static_configs: [{ targets: ["omni-omniproject:3000"] }]
  ```

  The chart also sets `prometheus.io/scrape` pod annotations for annotation-based discovery.

### Turn on OTLP export (spans + metrics push)

Point the shell at an OTLP/HTTP collector and it will **additionally**: export a SERVER span per
request, and **push** the same metric set (RED + broker latency + cache hit/miss) on an interval.
This is the "real metrics + spans" path for Datadog / Honeycomb / Tempo / Grafana Agent / the OTel
Collector.

```yaml
# values.yaml
otel:
  enabled: true
  endpoint: "http://otel-collector:4318"   # OTLP/HTTP base (the app appends /v1/traces, /v1/metrics)
  serviceName: "omniproject-gateway"
  headers: "api-key=..."                    # optional, comma-separated k=v
  metricExportIntervalMs: "60000"           # optional; default 60000
```

Equivalent environment variables (compose / bare process):

| Variable | Effect |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | **The gate.** Unset ⇒ no export (default). Set ⇒ spans + metrics export on. |
| `OTEL_SERVICE_NAME` | `service.name` on spans/metrics (default `omniproject-gateway`). |
| `OTEL_EXPORTER_OTLP_HEADERS` | Comma-separated `k=v` headers (e.g. vendor API key). |
| `OTEL_METRIC_EXPORT_INTERVAL` | Metric push interval in ms (default `60000`, floor `1000`). |

Notes:

- Export is **best-effort** — a slow/unreachable collector never blocks a request or the metric push
  (5s timeouts, errors swallowed to `debug` logs).
- The metric exporter is **cumulative** (temporality since process start); each replica reports its
  own series and the collector/Prometheus aggregates across them — the standard multi-replica model.
- Enabling OTLP does **not** disable the Prometheus scrape or trace-context headers; it's purely
  additive.
