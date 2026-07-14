# Deployment presets — compose × settings blueprint

Each customer archetype pairs a **docker-compose topology** with a **settings blueprint** (the same
known-good config the setup wizard's "Start from a blueprint" picker loads). The compose declares the
archetype with `SETTINGS_PRESET`, and the gateway self-configures to that blueprint at boot
(`lib/settings.ts applyBootSettingsPreset`) — so the infra and the in-app posture stay in lock-step.

The `.env` files here set only the archetype knobs (`SETTINGS_PRESET`, `AI_PROVIDER`, profile). Copy the
one you want to a project-root `.env`, add your secrets (`SESSION_SECRET`, and for BYO-SSO
`OIDC_*`), then run the matching base compose.

## Archetype → compose map

| Blueprint (`SETTINGS_PRESET`) | Base compose | Topology | For |
|---|---|---|---|
| `enterprise-pmo` | `docker-compose.enterprise.yml` | shell + n8n, BYO SSO + backends + AI | Enterprise PMO / portfolio governance |
| `growth-business` | `docker-compose.enterprise.yml` | shell + n8n, BYO | Scaling agile companies |
| `agency-services` | `docker-compose.enterprise.yml` | shell + n8n, BYO | Agencies / professional services |
| `nonprofit` | `docker-compose.slim.yml` | lean LAN stack, demo/BYO auth | Charities / NGOs |
| `regulated-selfhost` | `docker-compose.slim.yml` | lean self-hosted, on-device, minimal egress | Regulated / air-gap-leaning |
| `demo-trial` | `docker-compose.standalone.yml` | full local stack (n8n + Ollama + Authentik + Traefik TLS) | Evaluation with demo data |

`enterprise`, `slim` and `standalone` each already default `SETTINGS_PRESET` to their primary archetype;
set it explicitly (or via one of these `.env` files) to run a different blueprint on the same topology.

## Run

```bash
# 1. pick an archetype
cp deploy/presets/growth-business.env .env

# 2. add your secrets to .env (SESSION_SECRET, OIDC_* for the enterprise base, …)

# 3. bring up the matching base compose (see the table)
docker compose -f docker-compose.enterprise.yml up -d
```

Switch archetype without editing files by overriding the one variable:

```bash
SETTINGS_PRESET=nonprofit docker compose -f docker-compose.slim.yml up -d
```

## Notes

- **AI stays off (`AI_PROVIDER=none`) in every blueprint.** Provider API keys are never env vars — they
  go in the encrypted vault via **Settings → AI providers**. Set `AI_PROVIDER` here only to pre-select
  the kind (e.g. `ollama` for a local model on the standalone stack).
- **Everything remains editable.** A blueprint is a starting point; tweak anything in **Settings** or the
  **Configurator** afterwards, and each change is versioned/rollback-able.
- **The blueprint can't ship an illegal combo** — every preset is validated against the cross-field
  constraint registry (`lib/settings-constraints`) by a test, so a boot-seeded config is always valid.
