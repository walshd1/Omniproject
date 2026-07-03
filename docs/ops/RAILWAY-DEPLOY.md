# Deploying OmniProject on Railway

**Status: manual recipe, not yet a live "Deploy on Railway" button.** This
guide exists to answer the "needing an IT person for basic setup is not
acceptable" problem — a way to get a running, URL-reachable OmniProject
instance without a terminal, `docker compose`, or a Docker host of your own.
It's written for a maintainer (or a technical volunteer helping a small org)
to run through **once**, by hand, in the Railway dashboard. Once that manual
run is confirmed working, Railway lets you turn the project into a **Template**
from its dashboard — that's what produces a real "Deploy on Railway" button
URL, which only Railway can mint (there's no way to construct one in advance).
Until then, this doc **is** the deploy path.

Why Railway over Render/Fly/DigitalOcean: it's the only one of the four that
can import an existing `docker-compose.yml`-shaped stack directly (drag the
compose file onto the project canvas and it creates one Railway service per
compose service, on a shared private network), and it already has published
community templates for both of OmniProject's hardest optional pieces —
n8n and Authentik+Postgres — so a lot of the hard parts have prior art. See
`docs/PARKED-DECISIONS.md` §A2 for the fuller platform comparison.

## Tier 1 (recommended starting point): omni-shell + n8n, demo auth accepted

This is the actual "one click, no IT person, no SSO to configure" target.
OmniProject explicitly supports running without SSO as an accepted choice —
`DEPLOYMENT_PROFILE=nonprofit` + `ACCEPT_DEMO_AUTH=1` — for exactly this
case: everyone who reaches the URL is treated as admin, which is fine for a
**private evaluation instance** a small team is trying out, and not fine as
a permanently public URL a whole org logs into (see the warning at the end).

Two Railway services, no Traefik, no mkcert, no `.local` hostnames — Railway
terminates real HTTPS on a real domain for you, so the whole TLS-bootstrap
section of `docker-compose.standalone.yml` simply doesn't apply here.

1. **Create a Railway project**, then **add a service from this GitHub repo**
   (root `Dockerfile` — the same image `docker-compose.standalone.yml` and
   the Kubernetes manifest both deploy: SPA + gateway on one port). Railway
   builds it and assigns a public `*.up.railway.app` domain automatically.
   Point its **Config-as-code Path** (Settings) at
   [`deploy/railway/omni-shell.railway.json`](../../deploy/railway/omni-shell.railway.json)
   for the build + healthcheck settings, rather than re-entering them by hand.
2. **Add a second service** from the `n8nio/n8n` Docker image (pin the same
   version `docker-compose.standalone.yml` uses — see that file for the
   current pin). Attach a **persistent volume** at `/home/node/.n8n` (n8n's
   encryption key + local workflow data live there; without it, a redeploy
   wipes your imported workflow). Give this service a public domain too —
   you need it once, to open n8n's editor and import the workflow.
3. **omni-shell environment variables** (Railway → service → Variables):
   ```
   NODE_ENV=production
   DEPLOYMENT_PROFILE=nonprofit
   ACCEPT_DEMO_AUTH=1
   PUBLIC_URL=https://<the omni-shell public domain Railway assigned>
   SESSION_SECRET=<generate a long random string>
   BROKER_URL=http://<n8n service's private network hostname>:5678/webhook/omniproject
   ```
   Railway services on the same project reach each other over a private
   network by internal hostname (shown on the n8n service's Settings tab) —
   use that for `BROKER_URL`, not the public n8n domain, so broker traffic
   never leaves Railway's network.
4. **n8n environment variables:**
   ```
   N8N_HOST=<the n8n service's public domain>
   N8N_PROTOCOL=https
   WEBHOOK_URL=https://<the n8n service's public domain>/
   GENERIC_TIMEZONE=UTC
   DB_TYPE=sqlite
   ```
5. Deploy both. Confirm `https://<omni-shell domain>/api/readyz` returns
   healthy, then open the app, sign in (demo auth — no login form, you're
   already admin), and use the **Configurator** (`G+C`, or the sidebar) to
   generate + download a workflow for your real backend, import it into the
   n8n editor at the n8n domain, and verify it — same steps as
   `docs/QUICKSTART.md`, just against a hosted n8n instead of a local one.

**Cost:** roughly $5–15/month on Railway's Hobby plan for this footprint
(two small always-on services + the n8n volume).

**Before onboarding a whole team (not just evaluating alone):** demo auth
means anyone with the URL is an admin. Either keep the URL private to the
person evaluating it, put an `IP_ALLOWLIST` in front of it, or move to Tier 2
below for real per-user logins before wider use.

## Tier 2 — real per-user SSO, now with an actual config path (not just a sketch)

Adding real SSO means adding Authentik: `authentik-postgres`,
`authentik-server`, `authentik-worker` as three more Railway services,
mirroring `docker-compose.standalone.yml` minus Traefik/mkcert (Railway's
automatic HTTPS replaces that entire section) and minus the `.local`
hostname scheme (use each service's real Railway public domain instead of
`app.local` / `authentik.local`).

**The one real gotcha, solved rather than just flagged:** the compose file
auto-provisions the OmniProject OAuth app + role groups in Authentik by
bind-mounting `./infra/authentik/blueprints` read-only into the Authentik
containers. Railway doesn't support bind-mounting an arbitrary repo
subdirectory into a running service the way Docker Compose does. Rather than
skip the blueprint and wire the OAuth app by hand, [`deploy/railway/`](../../deploy/railway/)
now ships the other fix: a small custom Authentik image
([`deploy/railway/authentik/Dockerfile`](../../deploy/railway/authentik/Dockerfile))
that bakes the same blueprint in at build time — same pinned upstream image,
same auto-provisioning effect, no bind mount needed.

1. **authentik-postgres** — plain `postgres:16.14-alpine` (or whatever
   `docker-compose.standalone.yml` currently pins) as a "Deploy Docker Image"
   service, a persistent volume at `/var/lib/postgresql/data`, and
   `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` set as Variables. No
   config-as-code file — it's a bare image, not built from this repo.
2. **authentik-server** and **authentik-worker** — two services *built from
   this repo*, each with **Root Directory left at its default** (the repo
   root — the Dockerfile is written for a repo-root build context on
   purpose) and **Config-as-code Path** pointed at
   [`deploy/railway/authentik/server.railway.json`](../../deploy/railway/authentik/server.railway.json)
   and
   [`deploy/railway/authentik/worker.railway.json`](../../deploy/railway/authentik/worker.railway.json)
   respectively. Both need the same env vars
   `docker-compose.standalone.yml`'s `authentik-server`/`authentik-worker`
   sections set (`AUTHENTIK_POSTGRESQL__*`, `AUTHENTIK_SECRET_KEY`,
   `AUTHENTIK_OMNI_CLIENT_SECRET`) pointed at authentik-postgres's private
   network hostname. Give authentik-server a public domain (needed for its
   own admin UI and as the OIDC issuer); the worker needs no public domain.
3. **omni-shell** additionally needs `OIDC_ISSUER_URL` set to
   `https://<authentik-server's public domain>/application/o/omniproject/`,
   plus `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` matching what you set on
   Authentik. Drop `ACCEPT_DEMO_AUTH`/`DEPLOYMENT_PROFILE=nonprofit` from
   Tier 1 once this is wired — you're no longer running on demo auth.
4. Full wiring reference (env var names, the blueprint's exact effect,
   the manual-fallback path if you ever need to recreate the OAuth app by
   hand instead): [`docs/DEPLOY-LOCAL.md`](../DEPLOY-LOCAL.md) §4–5 — same
   Authentik setup, just against Railway's real domains instead of mkcert's
   `.local` ones.

See [`deploy/railway/README.md`](../../deploy/railway/README.md) for exactly
which dashboard field each file wires up. This tier's config files are
written to Railway's verified schema and are valid JSON, but — like Tier 1 —
**not yet run end-to-end against a live Railway account from here**; confirm
Authentik's own admin UI comes up and a test login round-trips through
`/api/auth/callback` before relying on it for more than a test.

## Turning a working deployment into a real "Deploy on Railway" button

Once Tier 1 (or Tier 2) is confirmed working end to end in your own Railway
account: Railway's dashboard has a **"Create Template"** action on an
existing project, which packages its services/variables into a shareable
template and gives you the real deploy-button URL and markdown snippet —
Railway generates that URL; nothing here can predict it in advance. Add that
button to the README's testers section once you have it.
