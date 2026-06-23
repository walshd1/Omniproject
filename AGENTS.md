# OmniProject

A stateless **program-management overlay** — a single pane of glass over whatever
project backend(s) an organization already runs, with **n8n as the exclusive
middleware/API hub**. It is **backend-agnostic**: any system n8n can reach (Jira,
Azure DevOps, ServiceNow, GitHub, Plane, OpenProject, …) can be federated
underneath — no specific backend is required. The brutalist, keyboard-driven shell
renders a dual-lens view (Agile board + Gantt timeline) and brokers every read and
write through the n8n gateway; the API server's sample data stands in for
n8n-federated state until workflows are wired. The `backendSource` setting is a
free-form routing hint (default `all`).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API/gateway (reads `PORT`, default expectation 8080 in dev)
- `pnpm --filter @workspace/omniproject run dev` — run the SPA (Vite); proxies `/api` → `API_PROXY_TARGET` (default `http://localhost:8080`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/scripts run verify-n8n` — bidirectional n8n contract test (needs the API server running; set `OMNI_API_BASE`)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from the OpenAPI spec
- Required env (API server): `PORT`. Optional: `N8N_WEBHOOK_URL`, `SESSION_SECRET`, `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`, `PUBLIC_URL`, `STATIC_DIR`.

## Stack

- pnpm workspaces, Node.js 22+, TypeScript 5.9
- Frontend: Vite + React 19, wouter (routing), Zustand (UI state), TanStack Query, Tailwind v4, shadcn/Radix UI, cmdk, lucide-react
- API/Gateway: Express 5, pino (logs redact auth/cookie headers)
- Validation: Zod (`@workspace/api-zod`), generated from the OpenAPI spec
- API codegen: Orval → React Query hooks (`@workspace/api-client-react`) + Zod
- Build: Vite (SPA) and esbuild (API → self-contained CJS/ESM bundle)

## Where things live

- **Frontend app:** `artifacts/omniproject/src` — pages in `pages/`, board views in `components/board/` (`AgileBoard`, `GanttChart`), `IssueDialog`, `CommandPalette`, `layout/AppLayout`, Zustand store in `store/useStore.ts`, auth client in `lib/auth.ts`.
- **API/Gateway:** `artifacts/api-server/src` — `routes/` (`health`, `auth`, `n8n-proxy`, `projects`), OIDC helper in `lib/oidc.ts`, app wiring in `app.ts`.
- **API contract (source of truth):** `lib/api-spec/openapi.yaml` → regenerates `lib/api-zod` and `lib/api-client-react`.
- **Deployment:** `Dockerfile` (builds the single `omni-shell` image), `docker-compose.standalone.yml`, `docker-compose.enterprise.yml` (lean BYO profile), `k8s-enterprise-manifest.yaml`.
- **n8n blueprints:** `artifacts/n8n-blueprints/omniproject-core-sync.json` — importable workflow implementing the gateway contract (routing, loop guard, per-user impersonation, normalization).

## Architecture decisions

- **Single-container "omni-shell".** All three deploy artifacts run one image on port 3000. The Express server serves both `/api/*` and the built SPA (`STATIC_DIR`) with a history fallback, so the SPA and gateway share an origin in production. In dev they're split (Vite proxies `/api`).
- **n8n is the sole data broker.** Mutating actions POST to `/api/n8n-proxy`, which attaches the session's OIDC bearer token and forwards to `N8N_WEBHOOK_URL`. The proxy forwards n8n's normalized `N8nActionResult` (`{ success, data, message }`) without re-wrapping.
- **Env-gated OIDC.** When `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` are set, the gateway runs a real Authorization-Code + PKCE flow (`/api/auth/login`→`/callback`) and stores a signed, httpOnly session cookie. Unset → demo mode (local session) so the app still runs without an IdP. Protected API routes return 401 without a session; the SPA's `AppLayout` guard redirects to `/login`.
- **Idempotency & loop guard.** `callN8n` appends `X-OmniProject-Idempotency-Key` = `sha256(action+projectId+issueId+second)` and an `origin` tag (`omniproject`). n8n drops echoes where `origin === lastUpdatedBy`, preventing circular Plane↔OpenProject webhook storms.
- **Per-user impersonation.** The outbound payload carries `userContext = { sub, email, name, token }` from the session so n8n writes downstream **as the active user** (`{{ $json.body.payload.userContext.token }}`), not a shared admin key.
- **Generated client.** Never hand-edit `lib/api-zod/src/generated` or `lib/api-client-react/src/generated`; change `openapi.yaml` and run codegen.

## Product

- **Dashboard (dual-lens):** Agile Kanban with native drag-to-move (PATCHes issue status) and a Gantt timeline driven by start/due dates; live activity feed; project switcher.
- **Issues:** create / edit / delete via a single dialog (status, priority, assignee, labels, dates); reachable from board columns, the "New Issue" button, or `Cmd+K`.
- **Projects index** with per-project summary (totals, completion %, overdue).
- **Settings:** n8n webhook URL, backend (free-form routing hint, default `all`), AI provider, OIDC issuer.
- **Command palette (`Cmd+K`)** + `g d/p/s` navigation; gateway health pill (CONNECTED/OFFLINE).

## Gotchas

- The generated query hooks type `query` as a full `UseQueryOptions`, so partial option objects need a `queryKey` (use the exported `get*QueryKey()` helpers).
- `vite.config.ts` requires `PORT` and `BASE_PATH` at config-eval time — set them for `vite build` too (the Dockerfile does).
- The API server bundle emits pino worker sidecar files next to `index.mjs`; ship the whole `dist/` dir.
- Docker image was not built in this cloud session (no docker daemon); each build step is verified individually.

## Pointers

- Workspace structure, TypeScript project references, and per-package details live in `pnpm-workspace.yaml` and each package's `package.json` / `tsconfig.json`.
