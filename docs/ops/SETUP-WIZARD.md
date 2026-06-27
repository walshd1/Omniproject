# First-run setup wizard

An interactive wizard that interviews you, **validates the result with the
gateway's own security self-check**, and writes a known-good `.env` +
`docker-compose.yml`. It is a guided correctness gate, not just a form filler.

It lives in `@workspace/scripts` — a **deployment tool, outside the runtime app**
(the gateway never imports it). It reuses the app's *pure* libraries (the backend
catalogue, the security self-check, the n8n workflow generator) as the single
source of truth.

```bash
pnpm --filter @workspace/scripts wizard
# or, from ./scripts:  pnpm wizard
```

## What it asks (questions branch on your answers)

1. **Project backend** — pick from the catalogue (Jira, OpenProject, Plane,
   ServiceNow, Azure DevOps, …) or **"custom"** (see *Onboarding a new backend*
   below); it shows the env that backend needs in n8n. Then: bundle a
   ready-to-configure **n8n** (the reference broker) or
   point at an external broker URL. Optional broker-hop **PSK** (only offered for
   an external hop without TLS).
2. **Identity provider** — external **OIDC** (Okta/Entra/Keycloak/your Authentik),
   **bundle Authentik** for me (adds Postgres + server + worker), or **none**
   (demo auth — loudly warned, dev/eval only).
3. **AI assistant** (optional) — OpenAI / OpenRouter / Anthropic / Ollama, with
   model + key; or none.
4. **Time-travel logging** (optional) — an external snapshot server (the one
   durable egress).
5. **Other operator choices** — port, the external `PUBLIC_URL` you front it with,
   and **multi-replica** (adds Redis for cross-replica fan-out + shared rate
   limits; bundled or external).

## What it does before writing

Runs `validateDeployConfig` — the **same** `securityFindings` the gateway runs at
boot — against your choices and prints findings at severity. A CRITICAL (e.g.
demo auth selected, or a plain-`http://` broker to a remote host) requires an
explicit confirm before it will write anything.

## What it writes

Into `./omniproject-deploy/` (or a directory you choose):

- **`.env`** (`chmod 600`, contains secrets — strong `SESSION_SECRET` and any
  passwords are generated for you; do **not** commit it).
- **`docker-compose.yml`** — the shell plus exactly the services you chose,
  mirroring the vetted reference compose files (pinned images, healthchecks,
  `no-new-privileges`, read-only shell, loopback-only port binding). It is
  validated by `docker compose config` in CI, so it is genuinely deployable.
- **`<backend>.workflow.json`** — for a shipped backend, the ready-to-import n8n
  workflow; for a custom one, a skeleton (see below).

Then it prints the exact `docker compose up` command and the per-choice next
steps (import the n8n workflow, configure the Authentik provider, `curl
/api/readyz`).

## Onboarding a new backend (the "custom" path)

Pick **"custom"** (or an enterprise backend with no shipped mapping) and the
wizard switches into guided onboarding instead of leaving you with a blank n8n. It
asks you to name the backend, then additionally writes:

- **`<backend>.workflow.json`** — a **structurally-valid, importable n8n skeleton**
  produced by the *same* generator the shipped backends use: webhook → verify/loop
  guards → route-by-action → one HTTP node per contract action (`list_projects`,
  `list_issues`, `create_issue`, `update_issue`, `delete_issue`,
  `get_capabilities`) with placeholder URLs referencing `CUSTOM_API_BASE` → respond.
- **`<backend>-binding-guide.md`** — a step-by-step walkthrough: set
  `CUSTOM_API_BASE`, **pull/inspect your API** and fill each node's URL/method,
  wire auth (forwarded user bearer by default, or an n8n credential), normalise
  responses to the contract shapes (`/api/contract`), **surface custom fields via
  describe → reconcile**, then **verify** with `POST /api/setup/test-n8n` and the
  `pnpm --filter @workspace/api-server smoke` conformance run before relying on it.

When conformance is green the backend is a first-class citizen with zero core
changes — and you're encouraged to contribute the finished mapping back as a
shipped `BackendManifest`.

> Lives in `@workspace/scripts/src/wizard/` — **outside the runtime app**.
> `deploy-config.ts` (env/compose) and `custom-backend.ts` (workflow skeleton +
> guide) are pure and unit-tested; `wizard.ts` is a thin readline shell. They
> reuse the app's pure libs (catalogue, security-check, workflow generator) by
> import, so there's a single source of truth. An Ansible role can reuse the same
> generators for fleet installs once the env contract is frozen.
