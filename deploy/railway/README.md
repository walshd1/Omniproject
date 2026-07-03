# Railway config-as-code

Config-as-code files for the services this repo can genuinely drive from git — see
[`docs/ops/RAILWAY-DEPLOY.md`](../../docs/ops/RAILWAY-DEPLOY.md) for the full deploy
walkthrough (Tier 1: omni-shell + n8n, demo auth; Tier 2: adds these Authentik
services for real per-user SSO). This directory is what makes Tier 2 an actual
runnable option instead of a hand-wired sketch.

## What's here, and why only these services

Railway's config-as-code (`railway.json`) only applies to services **built from this
git repo** — a service created from "Deploy Docker Image" (a bare image reference,
no repo attached) has no file in this repo to point at; its settings are Dashboard-only.
That's exactly n8n and Authentik's Postgres — plain upstream images, nothing to build,
configured directly in the Railway dashboard (image tag, env vars, a volume). See
`docs/ops/RAILWAY-DEPLOY.md` for their specific settings.

The two Authentik **application** services (`server`/`worker`) are different: the
bundled `docker-compose.standalone.yml` auto-provisions the OmniProject OAuth app +
role groups by bind-mounting `infra/authentik/blueprints/` read-only into the
container — Railway has no equivalent of a read-only bind mount from the repo into a
running service. `authentik/Dockerfile` fixes that the other way round: a two-line
image that starts from the exact same pinned `ghcr.io/goauthentik/server` tag and
bakes the blueprint in at build time. Same effect, no bind mount needed — and because
it's now a Dockerfile build *from this repo*, it can carry its own `railway.json` too.

| File | Railway service | What it configures |
|---|---|---|
| `omni-shell.railway.json` | the gateway + SPA (builds from the repo-root `Dockerfile`) | build + `/api/healthz` healthcheck |
| `authentik/Dockerfile` | (shared build for both Authentik services below) | bakes in the OmniProject blueprint |
| `authentik/server.railway.json` | Authentik server | `startCommand: server`, `/-/health/ready/` healthcheck |
| `authentik/worker.railway.json` | Authentik worker | `startCommand: worker` (no HTTP port, so no healthcheck path) |

## Wiring these up in the Railway dashboard

For **each** of the three services above (omni-shell, authentik-server, authentik-worker):

1. Create the service from this GitHub repo (not from a Docker image).
2. Leave **Root Directory** at its default (the repo root) for all three — the
   Dockerfiles above are written with repo-root build context on purpose, so nothing
   needs relocating and no per-service root-directory override is required.
3. In the service's Settings → **Config-as-code Path** (Railway dashboard field —
   this can't be set from a file, only the dashboard or the GraphQL API), point it at
   the matching file from the table above, e.g. `deploy/railway/omni-shell.railway.json`.
4. Set the environment variables from `docker-compose.standalone.yml`'s Authentik/
   omni-shell sections as Railway service Variables (real public Railway domains
   instead of the `.local` mkcert hostnames — see `docs/ops/RAILWAY-DEPLOY.md` Tier 2
   for the mapping).

n8n and Authentik's Postgres stay plain "Deploy Docker Image" services configured
directly in the dashboard — there's no config-as-code file for them to point at.

## Before trusting this end to end

These files are written to the verified Railway `railway.json` schema and validated
as syntactically correct JSON, but this sandbox has no Railway account/credentials to
actually click through and confirm a live deploy. Run through this once by hand and
confirm `/api/readyz` and Authentik's own admin UI both come up before relying on it.
