# Docker Compose correctness audit

This note records the audit of OmniProject's Compose topologies and the checks that now keep them
correct in CI. It covers the five compose files in the repo and the single `Dockerfile` they build.

## The topologies

| File | Purpose | TLS | IdP | Broker | Backends |
| --- | --- | --- | --- | --- | --- |
| `docker-compose.standalone.yml` | Full self-contained local stack | Traefik (mkcert) | bundled Authentik | n8n (sqlite) | local Ollama |
| `docker-compose.enterprise.yml` | BYO-everything evaluation | your ingress | your OIDC IdP | n8n (sqlite) | your systems |
| `docker-compose.slim.yml` | Smallest real deployment (small orgs/charities) | none (LAN HTTP by default) | demo auth by default, BYO OIDC optional | n8n (sqlite) | your systems |
| `docker-compose.loadtest.yml` | Disposable measurement rig | none | none | n8n **queue mode** + workers | OpenProject |
| `docker-compose.dev.yml` | Dev/debug **override** (layer on a base) | — | — | — | — |

The `Dockerfile` builds one image — `omniproject-shell` — that serves the SPA and the gateway on a
single port (3000); standalone, enterprise, slim, loadtest and the k8s manifest all deploy it.

## What was verified

- **Stateless posture is real.** The gateway (`omni-shell` / `gateway`) runs hardened in the
  production topologies: `security_opt: no-new-privileges`, `cap_drop: [ALL]`, `read_only: true`,
  `/tmp` as the only tmpfs. It persists nothing locally — config/AI keys live in the encrypted vault
  (or an external Vault/KMS backend), and durable security state is opt-in via an external backend.
  A read-only root FS is therefore correct, not a bug: there is nothing to write at rest by default.
- **The dev override is the only stateful path** and says so loudly. It mounts a writable
  `omni_dev_data:/data` volume for the capture tape + persisted demo state, on top of the base's
  read-only root (Compose merges the volume lists, so `./certs` stays mounted too). It flips
  `NODE_ENV=development`, which is the only switch that turns the (otherwise inert) debug surfaces on.
- **Healthchecks back every ordering dependency.** Every `depends_on … condition: service_healthy`
  targets a service that actually defines a `healthcheck`, so nothing waits forever.
- **Images are pinned.** Every pulled image carries an explicit, non-`latest` tag (Traefik, n8n,
  Ollama, Postgres, Authentik, Redis, OpenProject) for reproducible deploys.
- **No insecure Traefik dashboard.** Standalone serves the dashboard behind basic-auth over TLS
  (`api@internal` + a `dashboard-auth` middleware), never `--api.insecure`, and the `:8080` port is
  deliberately not published.
- **Liveness probes hit the right path.** Every gateway healthcheck targets `/api/healthz`, the
  dependency-free liveness route (200 regardless of broker reachability — readiness is `/readyz`).

No correctness defects were found in the compose files. Two robustness/coverage gaps were closed
(below).

## What changed

1. **A parseable compose guard** — `scripts/src/guard-compose.ts` (`pnpm --filter @workspace/scripts
   run guard-compose`), run in the CI `verify` job. It parses every compose file and asserts the
   invariants above (healthcheck-backed `depends_on`, pinned images, gateway hardening, no insecure
   dashboard) — the things `docker compose config` (a pure syntax/interpolation check) cannot see.
   Unit-tested in `scripts/src/guard-compose.test.ts`, including a live assertion over the real files.
2. **Wider `docker compose config` validation** in the `deploy-lint` job: the load-test file and the
   **dev override layered on the standalone base** are now validated too (previously only standalone
   and enterprise were).
3. **A liveness healthcheck on the load-test `gateway`**, so the rig can be brought up with `--wait`
   and the harness only starts measuring once the gateway is serving — matching the other topologies.
4. **`docker-compose.slim.yml`** — a fifth topology for small orgs/charities: the same `omni-shell` +
   single-n8n shape as enterprise, but with `DEPLOYMENT_PROFILE` defaulting to `self-hosted` and OIDC
   left optional (demo auth is an accepted choice under that profile, not a boot-refusal), and lower
   `mem_limit`s. Registered in `guard-compose.ts`'s `COMPOSE_FILES` as production-intent (`prod:
   true`), so it gets the same gateway-hardening + pinned-image + healthcheck checks as standalone and
   enterprise.

## Running the checks locally

```sh
pnpm --filter @workspace/scripts run guard-compose      # invariants (no Docker needed)
docker compose -f docker-compose.standalone.yml config -q
docker compose -f docker-compose.standalone.yml -f docker-compose.dev.yml config -q
docker compose -f docker-compose.enterprise.yml config -q
docker compose -f docker-compose.slim.yml config -q
docker compose -f docker-compose.loadtest.yml config -q
```
