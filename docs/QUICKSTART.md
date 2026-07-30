# Quickstart — running against your own data in 15 minutes

The fast path: clone → see it running → connect one real backend,
**read-only**, so nothing changes while you decide if it's useful. This skips
SSO, TLS certificates, and a production stack; [docs/DEPLOY-LOCAL.md](DEPLOY-LOCAL.md)
covers those later. For the fuller safety walkthrough (verify, sandbox, adding
writes, rollback) once you're past this, see [docs/SAFE-FIRST-RUN.md](SAFE-FIRST-RUN.md).
This page gets your own data on screen.

**You'll need:** Node.js 26+, pnpm (`corepack enable`), and an
[n8n](https://n8n.io) instance you can import a workflow into (n8n Cloud's free
tier works fine, or `docker run -p 5678:5678 n8nio/n8n`).

## Why this is the fast path (and why read-only first)

Of the three problems the [README](../README.md) names, this guide answers the
third, **migration risk**, in 15 minutes. You connect one real backend,
**read-only**, and OmniProject renders it live. It copies nothing out, writes
nothing new, and disconnecting when you're done moves nothing back, because
nothing ever moved. Read-only is the **default** the generator downloads (the
4–9 min step below): the workflow it hands you has no `create_issue` /
`update_issue` / `delete_issue` node, so there's no write path to disable.
OmniProject keeps no database of its own and opens no write path unless you opt
into one. Trying this against real data carries as little risk as it sounds.

---

## 0–2 min — clone and install

```bash
git clone https://github.com/walshd1/Omniproject.git
cd Omniproject
pnpm install
```

## 2–4 min — run it (zero config, sample data)

```bash
# Terminal 1 — gateway
PORT=8080 pnpm --filter @workspace/api-server run dev

# Terminal 2 — SPA
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/omniproject run dev
```

Open **http://localhost:5173** and click **ENTER (DEMO MODE)**. You're now
looking at the full app — dashboard, board, reports — over sample data, badged
`SAMPLE` so nothing is mistaken for real. Nothing has touched a network beyond
your machine.

## 4–10 min — generate a read-only workflow for your real backend

In the app: **Configurator → Generate an n8n workflow**, pick the
backend you actually use (Jira, OpenProject, GitHub, ServiceNow, Plane, and
others are free; SAP/Oracle/Dynamics/NetSuite are free too **right now** —
enforcement is dormant during the pre-community period, so no licence key
is actually required yet (see [LICENSING.md](../LICENSING.md) for when
that changes). Leave the **Read-only** checkbox on (it's
checked by default) and download the JSON — `omniproject-<backend>-readonly.json`.
Because every write action was left out at generation time, there is no
`create_issue` / `update_issue` / `delete_issue` node to find and delete: the
workflow you're about to import genuinely cannot mutate your backend, not
"won't", *can't*. In n8n: **Workflows → Import from File**. Fill in the one or
two env vars it needs (instance URL, credential) — the workflow tells you which.

## 10–12 min — wire it up and verify

```bash
export BROKER_URL=https://your-n8n.example.com/webhook/omniproject
```

(Or set it in **Configurator → Configuration** instead of an env var.) Then
**Configurator → Verify your workflow → Run verification** — this probes every read action with
`{ verify: true }`; generated workflows short-circuit on that flag, so **even
this check never touches your backend**. Green across the board means the
contract works.

## 12–15 min — look at your real data

Open a real project. What you're seeing is live from your backend, rendered
through OmniProject, and — because you only wired read actions — **there is no
way for this session to change it.**

---

### If something's stuck

- **Verify comes back red on one action** — that action's node in n8n is
  probably still pointed at a placeholder URL/credential; check the workflow's
  env vars against what your instance actually needs.
- **"ENTER (DEMO MODE)" won't go away** — `BROKER_URL` isn't set where the
  gateway process can see it (env var vs. Configurator → Configuration; the gateway
  needs a restart to pick up an env var change, but not a Configurator-panel change).
- **Nothing in n8n's execution log** — the SPA is still talking to demo mode;
  hard-refresh, or check the gateway logs for which broker URL it resolved.

### What's next

- Ready to let it write? [docs/SAFE-FIRST-RUN.md](SAFE-FIRST-RUN.md) covers
  pinning a known-good config, adding write nodes, and one-click rollback.
- Want the full standalone stack with real SSO and a bundled IdP instead of
  ad-hoc env vars? [docs/DEPLOY-LOCAL.md](DEPLOY-LOCAL.md).
- Running this for a small team or charity? [docs/SMALL-ORG-GUIDE.md](SMALL-ORG-GUIDE.md)
  has the non-technical walkthrough and the one-click charity setup.
- Something not working, or want to request a backend we don't have yet? Open
  an issue — templates are in [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/).
