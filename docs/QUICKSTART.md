# Quickstart — running against your own data in 15 minutes

This is the fast path: clone → see it running → connect one real backend,
**read-only**, so nothing can be changed while you decide if it's useful. No
SSO, no TLS certificates, no production stack — that's [docs/DEPLOY-LOCAL.md](DEPLOY-LOCAL.md)
for later. If you want the fuller safety walkthrough (verify, sandbox, adding
writes, rollback) once you're past this, that's [docs/SAFE-FIRST-RUN.md](SAFE-FIRST-RUN.md).
This page is just the shortest path to *your own data on screen*.

**You'll need:** Node.js 22+, pnpm (`corepack enable`), and an
[n8n](https://n8n.io) instance you can import a workflow into (n8n Cloud's free
tier works fine, or `docker run -p 5678:5678 n8nio/n8n`).

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

## 4–9 min — generate a workflow for your real backend

In the app: **Setup → Connection Center → Generate an n8n workflow**, pick the
backend you actually use (Jira, OpenProject, GitHub, ServiceNow, Plane, and
others are free; SAP/Oracle/Dynamics/NetSuite need a licence key — see
[LICENSING.md](../LICENSING.md)), and download the JSON. In n8n: **Workflows →
Import from File**. Fill in the one or two env vars it needs (instance URL,
credential) — the workflow tells you which.

## 9–12 min — make it physically read-only

Before you point OmniProject at it, open the imported workflow in n8n and
**delete (or disable) the `create_issue` / `update_issue` / `delete_issue`
nodes**. With no write path in the workflow, OmniProject cannot mutate your
backend — not "won't", *can't*. This is the one step worth not skipping.

## 12–14 min — wire it up and verify

```bash
export BROKER_URL=https://your-n8n.example.com/webhook/omni
```

(Or set it in **Setup → Configuration** instead of an env var.) Then **Setup →
Verify your workflow → Run verification** — this probes every read action with
`{ verify: true }`; generated workflows short-circuit on that flag, so **even
this check never touches your backend**. Green across the board means the
contract works.

## 14–15 min — look at your real data

Open a real project. What you're seeing is live from your backend, rendered
through OmniProject, and — because you only wired read actions — **there is no
way for this session to change it.**

---

### If something's stuck

- **Verify comes back red on one action** — that action's node in n8n is
  probably still pointed at a placeholder URL/credential; check the workflow's
  env vars against what your instance actually needs.
- **"ENTER (DEMO MODE)" won't go away** — `BROKER_URL` isn't set where the
  gateway process can see it (env var vs. Setup → Configuration; the gateway
  needs a restart to pick up an env var change, but not a Setup-panel change).
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
