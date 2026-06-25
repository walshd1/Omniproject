# Safe first run — try OmniProject with real data, in control

OmniProject can read and write to your real systems, but you decide how far it
goes and you can prove it's safe before any write happens. This is the
recommended on-ramp: **demo → read-only → dry-run verify → sandbox → add writes**,
with one-click rollback the whole way. Nothing here risks your production data.

> Why this is low-risk by construction: OmniProject **stores nothing** (no
> database/cache/copy), and **the n8n workflow *is* the integration** — so the
> gateway can only do what your workflow implements. See
> [README → Safe to try with your real data](../README.md#safe-to-try-with-your-real-data)
> and [SECURITY.md](../SECURITY.md).

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

In the app: **Setup → Connection Center**.

1. **Generate a workflow** for your backend (`POST /api/setup/generate-workflow`)
   and import it into n8n.
2. **Make it read-only:** in n8n, keep only the read actions
   (`list_projects`, `list_issues`, `list_activity`, `get_*`) and **delete or
   disable the `create_issue` / `update_issue` / `delete_issue` nodes** — or
   attach a backend credential that only has read scope. With no write path,
   OmniProject *cannot* mutate your backend, full stop.
3. **Test reachability** (`POST /api/setup/test-n8n`) — a non-destructive probe
   that just checks the webhook answers and reports which capabilities it exposes.
4. Point the gateway at it (`BROKER_URL`).

## Step 2 — Dry-run **verify** (probe without touching the backend)

**Setup → Verify** (`POST /api/setup/verify-workflow`) runs each **non-mutating**
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
2. Implement the write actions (`create_issue` / `update_issue` / `delete_issue`)
   in your n8n workflow. Each write now runs **as the logged-in user** (their own
   token is forwarded; the backend authorises it), is **concurrency-checked**
   (`expectedVersion` → `409`, never a silent overwrite), and is **idempotent**
   (dedup key + loop-guard).
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
