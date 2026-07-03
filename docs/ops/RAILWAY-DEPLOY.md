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

## Tier 2 (sketch — needs hands-on validation before relying on it)

Adding real SSO means adding Authentik: `authentik-postgres`,
`authentik-server`, `authentik-worker` as three more Railway services,
mirroring `docker-compose.standalone.yml` minus Traefik/mkcert (Railway's
automatic HTTPS replaces that entire section) and minus the `.local`
hostname scheme (use each service's real Railway public domain instead of
`app.local` / `authentik.local`).

**One real gotcha, flagged rather than papered over:** the compose file
auto-provisions the OmniProject OAuth app + role groups in Authentik by
bind-mounting `./infra/authentik/blueprints` read-only into the Authentik
containers. Railway doesn't support bind-mounting an arbitrary repo
subdirectory into a service the way Docker Compose does — only named
persistent volumes for a service's own writable data. Two ways through:
- Bake the blueprint into a small custom Authentik image (a two-line
  Dockerfile that `FROM ghcr.io/goauthentik/server:<pin>` and `COPY`s
  `infra/authentik/blueprints/omniproject.yaml` to the blueprints path), or
- Skip the blueprint and create the provider/application/groups by hand in
  the Authentik admin UI once — `docs/DEPLOY-LOCAL.md` §5 already documents
  this exact manual fallback (same slug, same redirect URI) for when the
  blueprint doesn't apply.

This tier is **not yet verified end-to-end on Railway** — treat it as a
starting sketch, and confirm each step actually boots before trusting it for
anything beyond a test.

## Turning a working deployment into a real "Deploy on Railway" button

Once Tier 1 (or Tier 2) is confirmed working end to end in your own Railway
account: Railway's dashboard has a **"Create Template"** action on an
existing project, which packages its services/variables into a shareable
template and gives you the real deploy-button URL and markdown snippet —
Railway generates that URL; nothing here can predict it in advance. Add that
button to the README's testers section once you have it.
