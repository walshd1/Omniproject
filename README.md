# OmniProject

> A stateless **program-management overlay** — a single pane of glass over your
> existing project backend(s) (Plane, OpenProject, Jira, Azure DevOps,
> ServiceNow, …) with **n8n** as the exclusive middleware / API hub.

OmniProject is a brutalist, keyboard-driven shell. It stores no project data
itself — your backends run underneath and every read and write is brokered
through n8n. It's **backend-agnostic**: anything n8n can reach can be federated
underneath, so it slots in alongside the systems an organization already runs.

```
┌─────────────┐     /api/*      ┌──────────────┐    webhook     ┌────────┐    ┌──────────────┐
│  SPA (Vite) │ ───────────────▶│  Gateway     │ ──────────────▶│  n8n   │───▶│ your backends │
│  React 19   │◀─────────────── │  (Express)   │◀────────────── │        │    │ Plane / OP /  │
└─────────────┘   normalized    └──────┬───────┘   normalized   └────────┘    │ Jira / SAP …  │
                                       │  OIDC (Authorization Code + PKCE)     └──────────────┘
                                       ▼
                                  ┌──────────┐
                                  │   IdP    │  Authentik (standalone) / BYO-SSO (enterprise)
                                  └──────────┘
```

In production the SPA and gateway ship as **one container** (`omni-shell`) on
port `3000`.

> **Implementing or integrating OmniProject?** See **[docs/TECHNICAL.md](docs/TECHNICAL.md)**
> for architecture, the n8n contract, the security model, the API surface, and
> data schemas.

---

## Features

- **Dual-lens dashboard** — Agile Kanban (drag-to-move) + Gantt timeline.
- **Issue management** — create / edit / delete from the board, a *New Issue*
  button, or the `Cmd+K` palette.
- **Enterprise reporting** (`/reports`) — Portfolio KPI cards (RAG), a Resource
  Heatmap (over-allocation alerts), and a Financial EVM chart (CPI/SPI).
- **Export & BI** — one-click report export to Excel, CSV, JSON, Markdown and PDF, plus a read-only API token for Power BI.
- **AI assist** — connect a local model (Ollama) or a public model (OpenRouter).
- **SSO** — env-gated OIDC against any provider; demo mode when unconfigured.
- **Keyboard-driven** — `Cmd+K` palette and `g d/p/r/s` navigation.

---

## Quick start (local, demo mode)

**Prerequisites:** Node.js 22+ and pnpm (`corepack enable`).

```bash
git clone https://github.com/walshd1/Omniproject.git
cd Omniproject
pnpm install
```

Run the gateway and SPA in two terminals:

```bash
# Terminal 1 — gateway (serves /api/*)
PORT=8080 pnpm --filter @workspace/api-server run dev

# Terminal 2 — SPA (proxies /api → http://localhost:8080)
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/omniproject run dev
```

Open **http://localhost:5173**. With no `OIDC_*` set, the login screen shows
**ENTER (DEMO MODE)** and issues a local session — the whole app is usable with
sample data until you wire up n8n and SSO.

---

## Using OmniProject

- **Dashboard** (`g d`) — switch the **Agile/Gantt** lens; drag cards between
  columns to change status; click a card or press *New Issue* to edit. Activity
  feed on the right.
- **Projects** (`g p`) — index with per-project summary; open a project for its
  board.
- **Reports** (`g r`) — portfolio RAG rollup, resource allocation heatmap, and
  Earned-Value financials per project.
- **Settings** (`g s`) — n8n webhook URL, backend routing hint, AI provider +
  model, OIDC issuer.
- **Command palette** — `Cmd+K` for navigation and quick actions.
- **Export** — the *Export* menu (Projects index / project board) downloads a
  `.xlsx` workbook or per-dataset `.csv`. For Power BI, see *Configuration* →
  `API_TOKENS` and the [technical doc](docs/TECHNICAL.md#2-identity--access).

---

## Deployment

The `Dockerfile` builds the single **`omni-shell`** image (SPA + gateway on port
`3000`). Liveness/readiness probes hit `/api/healthz`.

```bash
docker build -t omniproject-shell:latest .
```

### Standalone (bundled Authentik IdP — fastest to evaluate)

Includes `omni-shell`, `n8n`, `ollama`, Traefik, and Authentik, routed on
`*.local`.

```bash
docker compose -f docker-compose.standalone.yml up -d
```

Then in Authentik create an OAuth2 provider for OmniProject with redirect URI
`https://app.local/api/auth/callback` and set `OIDC_CLIENT_SECRET` to match.
Access the shell at **https://app.local**.

### Enterprise (BYO-SSO, lightweight)

No Traefik/Authentik/DB/LLM — just `omni-shell` + a single n8n on an isolated
bridge (~1.5 GB baseline). Supply your own OIDC provider and backend URLs.

```bash
export OIDC_ISSUER_URL=https://your-idp.example.com/...
export OIDC_CLIENT_ID=...  OIDC_CLIENT_SECRET=...  PUBLIC_URL=https://omni.example.com
export PLANE_INSTANCE_URL=...  OPENPROJECT_INSTANCE_URL=...   # or your own backends
docker compose -f docker-compose.enterprise.yml up -d
```

### Kubernetes

```bash
# edit the ConfigMap/Secret placeholders first
kubectl apply -f k8s-enterprise-manifest.yaml
```

### Sizing

| Scenario | CPU | RAM | Disk |
| -------- | --- | --- | ---- |
| Dev — shell only (demo) | 2 cores | 4 GB | ~2 GB |
| Enterprise — omni-shell + n8n (BYO SSO/backends) | 2 vCPU | 4 GB | 10 GB |
| Standalone (+ Authentik) | 4 cores | 8–16 GB | 20 GB+ |
| Standalone + local LLM (Ollama) | 4–8 cores | 16–32 GB | 30 GB+ |

> Your **backends** (Plane, OpenProject, …) are sized separately — budget for
> them on their own hosts. The k8s `omni-shell` pod requests `256Mi`/`100m`,
> limits `512Mi`/`500m`.

---

## Configuration

| Variable | Used by | Description |
| -------- | ------- | ----------- |
| `PORT` | gateway, SPA dev | Listen port (gateway serves API + SPA in prod) |
| `BASE_PATH` | SPA build | Base path for the SPA (e.g. `/`) |
| `PUBLIC_URL` | gateway | Public origin, used to build the OIDC redirect URI |
| `N8N_WEBHOOK_URL` | gateway | Target n8n webhook; when set, all data is brokered through n8n (else demo data) |
| `SESSION_SECRET` | gateway | Secret used to sign the session cookie (share across replicas) |
| `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | gateway | Enable real SSO (all three required) |
| `OIDC_SCOPE` | gateway | Scopes (default `openid profile email`) |
| `API_TOKENS` | gateway | Comma-separated **read-only** tokens for Power BI / scheduled exports |
| `AI_PROVIDER` | gateway | `none \| ollama \| openrouter \| openai \| anthropic` |
| `AI_MODEL` | gateway | Model name (per-provider default otherwise) |
| `OLLAMA_URL` / `OPENROUTER_API_KEY` | gateway | Provider connection (per `AI_PROVIDER`) |
| `STATIC_DIR` | gateway | Serve the built SPA from here (single-container mode; set by the image) |
| `API_PROXY_TARGET` | SPA dev | Where the Vite dev server proxies `/api` (default `http://localhost:8080`) |

n8n workflows additionally read backend endpoints such as `PLANE_INSTANCE_URL` /
`OPENPROJECT_INSTANCE_URL`. See the [technical doc](docs/TECHNICAL.md) for the
full security and integration reference.

---

## Documentation

- **[docs/TECHNICAL.md](docs/TECHNICAL.md)** — architecture, n8n contract,
  security model, API surface, data schemas, extending the system (for IT &
  implementers).
- **[artifacts/n8n-blueprints/README.md](artifacts/n8n-blueprints/README.md)** —
  the importable reference workflow and how to wire it to your backends.
- **[AGENTS.md](AGENTS.md)** — contributor/agent notes, build commands, gotchas.

---

## License & status

**Open-core.** The core is **Apache-2.0** ([`LICENSE`](LICENSE)) — free for any
use, including commercial. A small set of **premium features** (white-label
branding, company nomenclature, outbound webhooks, enterprise backend workflow
generation) is source-available under the **OmniProject Premium License**
([`LICENSE-PREMIUM.txt`](LICENSE-PREMIUM.txt)) and requires a licence key to run
in production. See **[LICENSING.md](LICENSING.md)** for the full model, including
how purchases auto-mint a key via Stripe/Gumroad.

> **No warranty.** OmniProject is pre-1.0 and provided **AS IS, without warranty
> of any kind**. A licence key entitles *use* of the premium features; it does
> **not** include support or any service-level commitment. **Paid support
> packages are planned** as a separate offering as the community grows — until
> then, help is best-effort and community-based.
