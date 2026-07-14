# Safe first run — try OmniProject with real data, in control

OmniProject can read and write to your real systems, but you decide how far it
goes and you can prove it's safe before any write happens. This is the
recommended on-ramp: **demo → read-only → dry-run verify → sandbox → add writes**,
with one-click rollback the whole way. Nothing here risks your production data.

> Why this is low-risk by construction: OmniProject **stores nothing** (no
> database/cache/copy), and **the broker *is* the integration** (the n8n
> workflow, by default) — so the gateway can only do what your workflow
> implements. See
> [README → Safe to try with your real data](../README.md#safe-to-try-with-your-real-data)
> and [SECURITY.md](../SECURITY.md).

## Why this exists (proof, not just a promise)

Of the three problems the [README](../README.md) names, this guide exists because the
second — **trusting that we store nothing** — can't just be asserted — it's
easy to *say* "we store nothing," hard to *trust* it enough to point a new tool at
the real Jira/SAP/ServiceNow instance a team's whole delivery picture depends on.
That's why this on-ramp is graduated rather than "just connect it and see": every
step (read-only wiring, a dry-run verify that never touches the backend, a sandbox
environment, instant rollback) lets you personally confirm the zero-at-rest
architecture holds, in your own environment, before extending any trust at all.
Nobody should have to take "stateless" on faith — that's exactly the migration-fear
problem the README names, and proving it beats promising it.

## Step 0 — See it work, zero config (demo mode)

With no environment set, OmniProject runs in **demo mode** against sample data —
no n8n, no SSO, nothing touched.

```bash
pnpm install
PORT=8080 node artifacts/api-server/dist/index.mjs    # open the SPA
```

Click around: dashboard, programmes, reports. Numbers are badged **SAMPLE/DERIVED**
so you always know what's real vs. illustrative.

## Step 1 — Wire n8n **read-only** (it physically can't write)

In the app: the **Configurator**.

1. **Generate a workflow** for your backend (`POST /api/setup/generate-workflow`)
   and import it into n8n. **It's read-only by default** — the UI checkbox and
   the API's `readOnly` param both default to `true`, so the JSON you get back
   simply never has a `create_issue` / `update_issue` / `delete_issue` node to
   begin with. There's no manual step to remember: with no write path in the
   workflow, OmniProject *cannot* mutate your backend, full stop. (Attaching a
   backend credential with only read scope is a good belt-and-braces extra, but
   it isn't required to get this guarantee.)
3. **Test reachability** (`POST /api/setup/test-broker`) — a non-destructive probe
   that just checks the webhook answers and reports which capabilities it exposes.
4. Point the gateway at it (`BROKER_URL`).

## Step 2 — Dry-run **verify** (probe without touching the backend)

**Configurator → Verify** (`POST /api/setup/verify-workflow`) runs each **non-mutating**
action against your n8n with `{ verify: true }`. Generated workflows honour that
flag and short-circuit, so **even reads never reach the backend** — you get a
green/red per-action checklist proving the contract works, with zero side
effects. Write actions are never probed.

## Step 3 — Use a **sandbox** environment

Do all of this in a named **sandbox** config, not production:

```http
POST /api/setup/environments            { "name": "sandbox" }   # create
POST /api/setup/environments/activate   { "name": "sandbox" }   # switch to it
```

Design and test integration config here; your `production` environment is
untouched. When you're happy, **promote** sandbox → production
(`POST /api/setup/promote { "from": "sandbox", "to": "production" }`).

## Step 4 — Browse your **real data**, with no write risk

Log in and open one real project. Because only read actions are wired, you're
seeing live backend data rendered through OmniProject and **nothing can change
it**. This is the safe "does this actually help us?" evaluation.

Want a machine/BI client too? Issue a **read-only API token** (`API_TOKENS` env) —
those principals are **GET-only**; a leaked token can never mutate.

## Step 5 — Add writes, when you trust it

1. **Pin the current config as known-good** first so you always have a safe point
   to return to: `POST /api/setup/versions/{id}/known-good`.
2. Get the write actions (`create_issue` / `update_issue` / `delete_issue`) into
   your n8n workflow — regenerate with the **Read-only** checkbox off (or
   `"readOnly": false`) to get a workflow with them already built, or add them
   by hand to the workflow you already imported. Each write now runs **as the
   logged-in user** (their own token is forwarded; the backend authorises it),
   is **concurrency-checked** (`expectedVersion` → `409`, never a silent
   overwrite), and is **idempotent** (dedup key + loop-guard).
3. Promote to production when verified.

## Step 6 — Roll back instantly if anything looks off

```http
POST /api/setup/rollback   { "toKnownGood": true }
```

One call restores the last known-good configuration. Pair with **audit**
(`AUDIT_LEVEL=writes|all`, optionally shipped to your SIEM via `AUDIT_HTTP_URL`)
to see exactly who did what, when, and whether it succeeded.

---

### The 30-second confidence summary

| Concern | What protects you |
| ------- | ----------------- |
| "Will it copy/keep our data?" | It stores **nothing** — no DB, cache, or copy. |
| "Could it change our backend before we trust it?" | Wire **read-only**; with no write node it **can't**. |
| "Can we test without side effects?" | **Verify** dry-run never touches the backend. |
| "What if a change breaks prod?" | **Sandbox** + **one-click rollback** to known-good. |
| "Will it clobber concurrent edits / double-write?" | Optimistic concurrency (`409`) + idempotency + loop-guard. |
| "Who did what?" | **Audit** log (optionally to your SIEM) + provenance badges. |
| "Whose permissions apply?" | Writes run **as the user**; the backend stays authoritative. |
