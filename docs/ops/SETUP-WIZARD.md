# First-run setup wizard

An interactive wizard that interviews you, **validates the result with the
gateway's own security self-check**, and writes a known-good `.env` +
`docker-compose.yml`. It is a guided correctness gate, not just a form filler.

```bash
pnpm --filter @workspace/api-server wizard
# or, from artifacts/api-server:  pnpm wizard
```

## What it asks (questions branch on your answers)

1. **Project backend** — pick from the catalogue (Jira, OpenProject, Plane,
   ServiceNow, Azure DevOps, …) or "custom"; it shows the env that backend needs
   in n8n. Then: bundle a ready-to-configure **n8n** (the reference broker) or
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

Then it prints the exact `docker compose up` command and the per-choice next
steps (import the n8n workflow, configure the Authentik provider, `curl
/api/readyz`).

> The logic lives in `lib/deploy-config.ts` (pure, unit-tested); `wizard.ts` is a
> thin readline shell. An Ansible role can reuse the same generators for
> repeatable/fleet installs once the env contract is frozen.
