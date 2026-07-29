# Internal dogfood pilot — runbook

**Goal:** prove the one thing 116 unit-tested engines can't — that the **broker seam works
against a live Jira** — and decide go/no-go on writing back, using only what already ships in
this repo. Two sprints: read-only first, two write paths second.

**Why this first:** every backend manifest is `"verification": "catalogued"`, not live-verified
(see `lib/backend-catalogue/vendors/backends/jira.json`). Until a real Jira populates the boards
and reports, everything downstream (SSO hardening, attestation, scale) is built on an unproven
hop. This pilot retires that risk cheaply and produces the first real latency numbers
(`docs/ENTERPRISE-READINESS.md` gap #3).

---

## 0. Scope & expectations (read before you start)

- **What the pilot exercises:** the **issues + scheduling** planes. `jira.json` advertises
  `capabilities: { issues: true, scheduling: true, blockers: true, … }` and **`financials`,
  `raid`, `resources`, `portfolio`, `history` = false**. So the boards, sprint/flow/cycle-time
  reports, epic-hierarchy roll-up and Gantt light up; the **finance / RAID / resource-heatmap
  reports will be gated OFF** for a Jira-only backend — that's correct, not a bug. Set that
  expectation with the team up front.
- **Zero-at-rest still holds:** nothing about the pilot copies Jira data into a store. Rollback
  is `docker compose down` — there is nothing to migrate back.
- **One team, one real Jira project.** Prefer a *messy, customised* project over a pristine one —
  odd custom fields and non-standard workflows are exactly what the field-mapping needs to meet.

---

## 1. Stand up the stack (day 1)

Use the batteries-included local stack — it bundles the gateway, the **n8n** reference broker,
a local **Authentik** IdP (real SSO), and Traefik TLS. File: `docker-compose.standalone.yml`;
full bootstrap in `docs/DEPLOY-LOCAL.md`.

```bash
# 1. Trust a local CA + mint *.local certs (ACME can't issue for .local)
mkcert -install
mkdir -p certs
mkcert -cert-file certs/local.pem -key-file certs/local-key.pem \
       app.local n8n.local authentik.local ollama.local traefik.local
cp "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem

# 2. Point the hostnames at loopback
echo "127.0.0.1 app.local n8n.local authentik.local ollama.local traefik.local" | sudo tee -a /etc/hosts

# 3. Secrets (compose fails fast if any are missing)
cp .env.example .env
#   set: OIDC_CLIENT_SECRET, SESSION_SECRET, AUTHENTIK_PG_PASSWORD,
#        AUTHENTIK_SECRET_KEY (50+ chars), TRAEFIK_DASHBOARD_AUTH (htpasswd bcrypt; $ → $$)
#   optional: SETTINGS_PRESET=enterprise-pmo   (default demo-trial; presets in deploy/presets/)

docker compose -f docker-compose.standalone.yml up -d
```

**Checkpoint:** `https://app.local` loads and you can log in through Authentik.
The blueprint auto-creates the OAuth app + role groups (`omni-admins`, `omni-pmo`,
`omni-managers`, `omni-contributors`, `omni-viewers`). Add each pilot user to
**`omni-viewers`** for sprint 1.

---

## 2. Point the broker at real Jira — READ-ONLY (day 1–2)

The gateway is broker-agnostic: it POSTs normalised commands to `BROKER_URL`
(`http://n8n:5678/webhook/omniproject`), which the standalone compose already sets, so the
gateway runs the **live `ReferenceBroker`** (`artifacts/api-server/src/broker/index.ts:52` —
`BROKER_URL` set ⇒ live). All you wire is the n8n workflow + Jira credentials.

1. **Generate a READ-ONLY Jira workflow** from the manifest. `generateWorkflow` takes a
   first-class `readOnly` flag (`lib/backend-catalogue/src/workflow-generator.ts:226`), so the
   emitted workflow contains **only `list_projects` + `list_issues`** — writes are *physically
   impossible*, not merely gated:

   ```bash
   pnpm --filter @workspace/scripts run gen-workflow-blueprints   # emits importable n8n workflows
   #   → use the Jira blueprint generated with { readOnly: true }, webhookPath "omniproject"
   ```
   (Or use the in-app **Broker/Backend picker** at Settings → Setup — `components/setup/BrokerPicker`.)

2. **Import** that workflow into n8n (`https://n8n.local`) and **activate** it so it serves
   `POST /webhook/omniproject`.

3. **Give n8n the Jira credentials** — `jira.json` `requiredEnv`. Set on the `n8n` service in the
   compose (or n8n's own env), then `docker compose up -d n8n`:
   ```
   JIRA_INSTANCE_URL = https://<your-org>.atlassian.net
   JIRA_BASIC_AUTH   = base64("<email>:<api_token>")   # a scoped Jira API token
   ```

4. **In the app:** create/point one project at the real Jira project key and confirm the
   capability set resolves to issues + scheduling only.

**Live proof (this is the real test, not a unit test):**
- Real Jira issues appear in the **board** and the sprint/flow/cycle-time/hierarchy **reports**.
- **n8n → Executions** shows each `list_*` call succeeding, with its duration.
- Run the broker-contract conformance check (validates the gateway ↔ broker payload shape;
  mock-based, so it's a shape check, not the live check): `pnpm --filter @workspace/scripts run verify-broker`.

---

## 3. Sprint 1 — read-only, one team, one week

Put the boards + the lit-up reports in front of the team as their **daily read** alongside Jira.
Collect, don't build.

**Capture (a shared doc is enough):**
- p95 **read latency** — from n8n execution durations + the gateway (compare to opening the Jira
  board directly).
- **Error rate** — any red n8n executions; any field that renders blank/`—` because the mapping
  missed a custom field (note the field + issue type).
- **Qualitative:** "does this board/report beat your Jira view?" per person, 1–5 + one sentence.

**Sprint 1 exit criteria (go/no-go to enable writes):**
- [ ] Boards + reports populate from real Jira for every pilot user.
- [ ] No unexplained blank fields on the team's common issue types (mapping gaps logged, not silent).
- [ ] Read p95 acceptable at the project's real issue volume.
- [ ] `verify-broker` green (contract shape conforms).
- [ ] Team net-positive on "beats the Jira view."

If any fail: fix the mapping (`jira.json` Normalize notes: sprint/story-point custom fields) or
stop — do **not** proceed to writes on a shaky read path.

---

## 4. Sprint 2 — enable exactly two write paths (second week)

Only after sprint 1 is green. Keep the blast radius tiny.

1. **Regenerate the Jira workflow WITHOUT `readOnly`** (or add just `update_issue` + `create_issue`
   nodes), re-import, re-activate.
2. Move pilot users to **`omni-contributors`**; keep the write scope to **status change** +
   **comment/create** only. The org→programme→project gating and the maker-checker engine
   (`dual-control.ts`) stay as shipped.
3. **Exercise the conflict path on purpose:** two people edit the same issue; confirm the
   optimistic-concurrency `expectedVersion` returns **409 → "refreshed instead of overwriting"**
   (the behaviour in `use-issue-field-write.tsx`), i.e. no silent clobber. This is the single most
   important write-back guarantee to witness live.

**Sprint 2 exit criteria (go/no-go on the whole pilot):**
- [ ] A status change + a comment round-trip to Jira and back, verified in Jira itself.
- [ ] The 409 conflict path fires and refreshes rather than clobbering.
- [ ] Undo (toast + Ctrl/⌘+Z) reverts a field edit through the same path.
- [ ] Zero data-integrity surprises in Jira's own history.

---

## 5. Decision & what it unlocks

- **All green →** the live seam is proven. *Now* the enterprise sequence in
  `docs/ENTERPRISE-READINESS.md §5` is worth funding: SSO-first (make SAML default, not opt-in),
  then the scale-proof run (gap #3 — you already have a real latency baseline to publish), then
  the evidence pack. Line up **one external design partner** to retest the mapping against a Jira
  you didn't author.
- **Read good, writes shaky →** ship as a **read-only insights layer** over Jira first (still
  valuable, zero write-risk) and iterate the write path separately.
- **Read shaky →** the gap is broker/field-mapping robustness; fix `jira.json` (and the
  workflow-generator normalisation) before anything else. This is the cheapest possible place to
  have learned it.

---

## Appendix — the exact files this runbook leans on

| Concern | File |
| --- | --- |
| Local stack (gateway + n8n + Authentik + Traefik) | `docker-compose.standalone.yml`, `docs/DEPLOY-LOCAL.md` |
| Jira binding (actions, `requiredEnv`, capabilities) | `lib/backend-catalogue/vendors/backends/jira.json` |
| Live-vs-demo broker selection | `artifacts/api-server/src/broker/index.ts` |
| Read-only workflow generation | `lib/backend-catalogue/src/workflow-generator.ts` (`generateWorkflow({ readOnly })`), `scripts/src/gen-workflow-blueprints.ts` |
| Broker-contract conformance | `pnpm --filter @workspace/scripts run verify-broker` |
| Optimistic-concurrency / 409 write safety | `artifacts/omniproject/src/lib/use-issue-field-write.tsx` |
| Maker-checker on sensitive writes | `dual-control.ts` |
| Deployment presets | `deploy/presets/*.env` |
| The enterprise gap analysis this feeds | `docs/ENTERPRISE-READINESS.md`, `docs/FEATURE-MATURITY.md` |
