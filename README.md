# OmniProject

> A stateless **program-management overlay** — a single pane of glass over headless
> project backends (**Plane**, **OpenProject**) with **n8n** as the exclusive
> middleware / API hub.

OmniProject is a brutalist, keyboard-driven shell. It does not store project data
itself — Plane and OpenProject run underneath, and every read and mutating action
is brokered through n8n. The UI presents a **dual-lens** view (Agile Kanban + Gantt
timeline) and pushes actions through a thin gateway that attaches the user's OIDC
bearer token before forwarding to n8n.

```
┌─────────────┐     /api/*      ┌──────────────┐    webhook     ┌────────┐    ┌─────────────┐
│  SPA (Vite) │ ───────────────▶│  Gateway     │ ──────────────▶│  n8n   │───▶│   Plane     │
│  React 19   │◀─────────────── │  (Express)   │◀────────────── │        │    │ OpenProject │
└─────────────┘   normalized    └──────┬───────┘   normalized   └────────┘    └─────────────┘
                                       │  OIDC (Authorization Code + PKCE)
                                       ▼
                                  ┌──────────┐
                                  │   IdP    │  Authentik (standalone) / BYO-SSO (enterprise)
                                  └──────────┘
```

In production the SPA and gateway ship as **one container** (`omni-shell`) on port
`3000`: Express serves both `/api/*` and the built static SPA.

---

## Features

- **Dual-lens dashboard** — Agile Kanban with native drag-to-move (updates issue
  status via the API) and a Gantt timeline driven by start/due dates.
- **Issue management** — create / edit / delete from board columns, a *New Issue*
  button, or the `Cmd+K` palette.
- **Command palette** (`Cmd+K`) and `g d` / `g p` / `g s` navigation shortcuts.
- **Env-gated OIDC SSO** — real Authorization Code + PKCE flow against any OIDC
  provider; demo mode when no provider is configured so it still runs locally.
- **n8n gateway** — the sole data broker; the proxy attaches the session bearer
  token and forwards n8n's normalized result.
- **Tri-mode deployment** — Docker Compose (standalone with bundled Authentik),
  Docker Compose (enterprise / BYO-SSO), and Kubernetes.
- **Live gateway health** indicator and an activity feed.

---

## Tech stack

| Layer        | Choice                                                                   |
| ------------ | ------------------------------------------------------------------------ |
| Frontend     | Vite + React 19, wouter (routing), Zustand (UI state), TanStack Query     |
| UI           | Tailwind CSS v4, shadcn / Radix UI, cmdk, lucide-react                    |
| Gateway      | Express 5, pino (logs redact auth/cookie headers)                         |
| Contracts    | OpenAPI → Orval → React Query hooks + Zod schemas                         |
| Build        | Vite (SPA), esbuild (gateway → self-contained bundle)                     |
| Tooling      | pnpm workspaces, Node.js 22+, TypeScript 5.9                             |

---

## Hardware requirements

OmniProject itself (the `omni-shell` container) is lightweight. The footprint is
dominated by the **optional companions you run alongside it** — n8n, the bundled
Authentik IdP, a local Ollama LLM, and the Plane / OpenProject backends underneath.

| Scenario | CPU | RAM | Disk | Notes |
| -------- | --- | --- | ---- | ----- |
| **Dev — shell only** (gateway + SPA, demo mode, no Docker) | 2 cores | 4 GB | ~2 GB | Just Node.js 22+. The fastest way to work on the UI/gateway. |
| **Standalone stack** (omni-shell + n8n + Traefik + Authentik ×4 + Ollama) | 4 cores | 8 GB min · **16 GB recommended** | 20 GB+ | Authentik (server/worker/redis/postgres) needs ~2 GB on its own. |
| **Standalone + local LLM** (Ollama running a model) | 4–8 cores | **16–32 GB** | 30 GB+ | A 7B model needs ~8 GB RAM (more for larger models); a GPU is strongly recommended for usable latency. |
| **Production (per node)** — omni-shell + n8n, BYO external SSO | 2 vCPU | 4 GB | 10 GB | The shell pod requests `256Mi`/`100m`, limits `512Mi`/`500m`. Scale n8n with workflow load. |

> **Backends are sized separately.** Plane and OpenProject are each multi-container
> apps (Postgres, Redis, workers) with their own substantial requirements — budget
> at least an extra **4 GB RAM each** if you self-host them on the same machine.

---

## Setup & get running

### Prerequisites

| Tool | Version | Why |
| ---- | ------- | --- |
| **Node.js** | 22+ | runtime for the gateway and build tooling |
| **pnpm** | 9+ (via `corepack enable`) | workspace package manager |
| **Docker** + Compose | recent | only for the standalone / enterprise stacks |

```bash
# Enable pnpm (ships with Node via corepack)
corepack enable
node -v   # expect v22 or newer
```

### 1 · Clone and install

```bash
git clone https://github.com/walshd1/Omniproject.git
cd Omniproject
pnpm install
```

### 2 · Run locally (demo mode — no IdP needed)

Open two terminals from the repo root.

```bash
# Terminal 1 — the gateway (serves /api/*)
PORT=8080 pnpm --filter @workspace/api-server run dev
```

```bash
# Terminal 2 — the SPA (proxies /api → http://localhost:8080)
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/omniproject run dev
```

Open **http://localhost:5173**. With no `OIDC_*` variables set, the login screen
shows **ENTER (DEMO MODE)** and issues a local session — you can use the whole app
without an identity provider. (Data is sample/federated-stand-in until you wire n8n.)

> The Vite dev server proxies `/api` to the gateway. Point it elsewhere with
> `API_PROXY_TARGET=http://host:port`.

### 3 · Verify the n8n data contract (optional)

```bash
# start the gateway pointed at a throwaway mock port, then run the test
PORT=5000 N8N_WEBHOOK_URL=http://127.0.0.1:19678/webhook/omniproject \
  node artifacts/api-server/dist/index.mjs &           # needs a prior build (step 5)
OMNI_API_BASE=http://localhost:5000 \
  pnpm --filter @workspace/scripts run verify-n8n        # 32 assertions, both directions
```

### 4 · Run the whole stack with Docker (real SSO via Authentik)

```bash
docker compose -f docker-compose.standalone.yml up -d
```

This starts `omni-shell`, `n8n`, `ollama`, Traefik, and Authentik. Then in
Authentik create an OAuth2 provider for OmniProject with redirect URI
`https://app.local/api/auth/callback`, and set `OIDC_CLIENT_SECRET` to match.
Access the shell at **https://app.local** (Traefik routes `*.local`).

### 5 · Build for production

```bash
pnpm run build                                    # typecheck + build everything
# or the single deployable image:
docker build -t omniproject-shell:latest .        # SPA + gateway on port 3000
```

### Common commands

| Command | Description |
| ------- | ----------- |
| `pnpm run typecheck` | Typecheck every package |
| `pnpm run build` | Typecheck + build all packages |
| `pnpm --filter @workspace/omniproject run build` | Build the SPA (needs `PORT` + `BASE_PATH`) |
| `pnpm --filter @workspace/api-server run build` | Build the gateway bundle |
| `pnpm --filter @workspace/scripts run verify-n8n` | n8n contract test (gateway must be running; set `OMNI_API_BASE`) |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate hooks + Zod schemas from `openapi.yaml` |

> **Generated code is not hand-edited.** Change `lib/api-spec/openapi.yaml` and run
> codegen to update `lib/api-zod` and `lib/api-client-react`.

---

## Repository layout

```
.
├── artifacts/
│   ├── omniproject/        # Vite + React SPA (the shell)
│   │   └── src/
│   │       ├── pages/                  # Home, Projects, ProjectDetail, Settings, Login
│   │       ├── components/board/       # AgileBoard, GanttChart
│   │       ├── components/             # IssueDialog, CommandPalette, layout/AppLayout
│   │       ├── store/useStore.ts       # Zustand UI state
│   │       └── lib/auth.ts             # OIDC session client
│   └── api-server/         # Express gateway
│       └── src/
│           ├── routes/                 # health, auth, n8n-proxy, projects
│           ├── lib/oidc.ts             # OIDC (Authorization Code + PKCE) helper
│           └── app.ts                  # wiring + static SPA serving
├── lib/
│   ├── api-spec/           # openapi.yaml (source of truth) + Orval config
│   ├── api-zod/            # generated Zod schemas
│   ├── api-client-react/   # generated React Query hooks + fetch layer
│   └── db/                 # Drizzle schema (scaffold)
├── scripts/
│   └── src/verify-n8n-bidirectional.ts # contract test (mocks n8n, both directions)
├── Dockerfile                          # builds the single omni-shell image
├── docker-compose.standalone.yml       # omni-shell + n8n + ollama + traefik + Authentik
├── docker-compose.enterprise.yml       # BYO-SSO, direct host ports
└── k8s-enterprise-manifest.yaml        # Deployments, Services, Ingress, ConfigMap/Secrets
```

---

## Authentication (OIDC)

The gateway is an OIDC **relying party** — it never stores passwords or issues its
own tokens; it delegates to your IdP and keeps a signed, httpOnly **session cookie**
wrapping the issued tokens.

- **Configured** (`OIDC_ISSUER_URL` + `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET` all
  set): real Authorization Code + PKCE flow. `/api/auth/login` → IdP → `/api/auth/callback`.
- **Unconfigured:** demo mode — a local session so the app still runs.

Protected API routes return `401` without a session; the SPA guard redirects to
`/login`. The n8n proxy attaches the session's bearer token to every forwarded request.

Register this redirect URI with your IdP: `${PUBLIC_URL}/api/auth/callback`.

---

## n8n contract

All mutating actions go through `POST /api/n8n-proxy`:

```jsonc
// request
{ "action": "create_ticket", "payload": { "title": "…" }, "source": "plane" }
```

The gateway attaches `Authorization: Bearer <token>`, `X-OmniProject-Action`, and
`X-OmniProject-Source`, then POSTs to `N8N_WEBHOOK_URL`. n8n is expected to return a
normalized result which the gateway forwards as-is:

```jsonc
// response (N8nActionResult)
{ "success": true, "data": { /* normalized state */ }, "message": "…" }
```

---

## Deployment

The `Dockerfile` builds the single **`omni-shell`** image (SPA + gateway on port
`3000`) that all three artifacts deploy.

### Standalone (bundled Authentik IdP)

Includes `omni-shell`, `n8n`, `ollama`, `traefik`, and Authentik (server, worker,
redis, postgres), routed via Traefik on `*.local`.

```bash
docker compose -f docker-compose.standalone.yml up -d
```

### Enterprise (BYO-SSO)

No Traefik/Authentik; direct host ports. Supply your own OIDC provider.

```bash
export OIDC_ISSUER_URL=https://your-idp.example.com/...
export OIDC_CLIENT_ID=...        export OIDC_CLIENT_SECRET=...
export PUBLIC_URL=https://omni.example.com
docker compose -f docker-compose.enterprise.yml up -d
```

### Kubernetes

```bash
# edit the ConfigMap/Secret placeholders first
kubectl apply -f k8s-enterprise-manifest.yaml
```

Liveness/readiness probes hit `/api/healthz` on port `3000`.

---

## Environment variables

| Variable | Used by | Description |
| -------- | ------- | ----------- |
| `PORT` | gateway, SPA dev | Listen port (gateway serves API + SPA in prod) |
| `BASE_PATH` | SPA build | Base path for the SPA (e.g. `/`) |
| `STATIC_DIR` | gateway | When set, the gateway serves the built SPA from here (single-container mode) |
| `N8N_WEBHOOK_URL` | gateway | Target n8n webhook for the proxy |
| `SESSION_SECRET` | gateway | Secret used to sign the session cookie |
| `OIDC_ISSUER_URL` | gateway | OIDC issuer (enables real SSO) |
| `OIDC_CLIENT_ID` | gateway | OIDC client id |
| `OIDC_CLIENT_SECRET` | gateway | OIDC client secret |
| `OIDC_SCOPE` | gateway | Scopes (default `openid profile email`) |
| `PUBLIC_URL` | gateway | Public origin, used to build the OIDC redirect URI |
| `API_PROXY_TARGET` | SPA dev | Where the Vite dev server proxies `/api` (default `http://localhost:8080`) |

---

## License

MIT
