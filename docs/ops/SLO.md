# Service levels & alerting baseline

A reference SLO + alerting baseline for the OmniProject **gateway** (the stateless overlay). It gives
ops a starting point to commit to and measure a service level. Adjust the targets to your contract.

> Scope note. These SLOs cover the **gateway** — the component this repo ships. Availability of your
> **systems of record** (Jira/OpenProject/…) and your **broker** is their own SLA: every read/write is
> live-brokered, so the gateway can only be as available as the backend it fronts. The broker-health
> alerts below make that dependency visible rather than hiding it.

## Reference SLOs

| SLI | Definition (PromQL source) | Target |
| --- | --- | --- |
| **Availability** | `1 − (5xx ÷ total requests)` — recording rule `omniproject:availability:ratio5m` | **≥ 99.9%** monthly |
| **Latency** | p99 gateway request latency — `omniproject:http_latency_p99_ms:5m` | **< 2000 ms** p99 |
| **Broker success** | non-error brokered-call ratio — from `omniproject_broker_requests_total` | **≥ 99%** (bounded by your backend) |

Error budget for 99.9% monthly ≈ **43m of downtime / month**. The `OmniProjectHighErrorRate` alert
(>5% 5xx for 10m) is deliberately tighter than the SLO so you page **before** the budget is spent.

## What ships

- **Alert + recording rules** — [`deploy/monitoring/prometheus-rules.yaml`](../../deploy/monitoring/prometheus-rules.yaml):
  a `PrometheusRule` with availability, error-rate, latency, saturation and broker-health alerts, plus
  the SLO recording rules above. The PromQL is pinned to the metric names the gateway actually exposes
  at `/api/metrics` (`artifacts/api-server/src/lib/runtime-metrics.ts`).
- **Dashboard** — [`deploy/monitoring/grafana-dashboard.json`](../../deploy/monitoring/grafana-dashboard.json):
  a RED (Rate / Errors / Duration) dashboard over the same metrics; import into Grafana and point it at
  your Prometheus datasource.
- **Metric export** — always-on Prometheus scrape at `/api/metrics`; set an OTLP collector
  (`otel.enabled` in [`values-enterprise.yaml`](../../deploy/helm/omniproject/values-enterprise.yaml)) to
  also push spans + RED metrics to a collector.

## Wiring it up

1. Deploy the gateway with the enterprise profile (`-f values-enterprise.yaml`) so replicas, HPA, PDB
   and OTLP are on and `/api/metrics` is scraped (the chart sets the `prometheus.io/scrape` pod
   annotations by default).
2. Apply the rules to a Prometheus Operator cluster:
   `kubectl apply -f deploy/monitoring/prometheus-rules.yaml` (adjust the `release:` selector label to
   match your Prometheus `ruleSelector`).
3. Import the Grafana dashboard and select your Prometheus datasource.
4. Route the `critical` alerts (`OmniProjectGatewayDown`, `OmniProjectHighErrorRate`,
   `OmniProjectBrokerFailures`) to your on-call; `warning` alerts to a triage channel.

## Health surfaces (for status pages / synthetic monitors)

- `GET /api/healthz` — liveness, dependency-free (process up).
- `GET /api/readyz` — readiness; returns **503** when the broker is unreachable, so a synthetic monitor
  hitting `/api/readyz` doubles as a backend-reachability check.
- `GET /api/metrics` — Prometheus exposition.

## Still the deployer's responsibility

An **uptime SLA commitment**, a public **status page**, synthetic/external monitoring, and the incident
process/escalation matrix are operational commitments an attested operating organisation makes — the
product provides the SLIs, alerts and health endpoints above to measure and drive them.
