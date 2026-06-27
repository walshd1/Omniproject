# OmniProject — launch kit

Everything needed to launch in one place: the positioning, ready-to-paste posts,
the GitHub release note, and the pre-launch checklist. Swap in the repo URL where
noted. Keep this updated as the messaging evolves.

> **Status:** `0.1.0` (first public release) and `0.2.0` (broker decoupling) have
> both shipped — see the [CHANGELOG](../../CHANGELOG.md) and the Releases page.
> The release-note template in §4 below is the original 0.1.0 note, kept as a
> reusable pattern; tags are **un-prefixed** (`0.1.0`, `0.2.0` — no `v`).

---

## 1. Positioning

### The one-liner (GitHub "About", post openers)

> **A project-management overlay with no database.** Your tools stay the single
> source of truth; everything goes through one neutral broker — n8n by default —
> so nothing syncs, nothing migrates, and if the broker can reach it (or it speaks
> a webhook), you can federate it.

### The pitch, in beats

1. **Programme management** — finance (EVM/CPI/SPI, multi-currency), time/schedule
   (Gantt, milestones), and resource capacity/allocation — not just a task board.
2. **No database** — nothing is copied, so nothing can drift; your backends stay
   the single source of truth and OmniProject is just a *view*.
3. **One neutral broker — n8n as the reference default** — no hand-rolled
   connectors to rot; one workflow per backend, the user's own token forwarded for
   real per-user audit.
4. **Connect to anything** — hundreds of broker integrations (n8n ships with
   hundreds out of the box), anything over HTTP/REST/GraphQL/SOAP/SQL, plus
   inbound/outbound webhooks.
5. **Not another system** — it fits the workflow (tools, your broker, SSO) you
   already run; adopt the views and connections you want, ignore the rest.
6. **Speaks your methodology** — Kanban, Scrum, Gantt/Waterfall, PRINCE2, RAID,
   list — one dataset, switch per team.
7. **Safe to try with real data** — it stores nothing, and *you* control whether
   it can write at all: wire only read actions in your broker and it's physically
   read-only. Dry-run verify, sandbox, and one-click rollback. (The #1 objection
   for any new tool — "I'm not letting it write to my Jira" — answered up front.)

### What's genuinely differentiated (be honest)

The *category* (PM aggregator / single pane of glass) is crowded. The
*architecture* — **stateless + broker-agnostic (n8n as the reference broker)** — is not; no direct
competitor builds it this way. Lead with the architecture, not "single pane of
glass." The honest gap to close at launch is **validation**: get one real team
running it against a real backend; that matters more than any next feature.

---

## 2. Where to post

| Channel | Fit | Watch out for |
| ------- | --- | ------------- |
| **r/selfhosted** | Strong — self-hostable, single container, open source | Lead with the free/self-host story; don't front-load the paywall. Disclose you're the dev. |
| **r/n8n** | Perfect niche — n8n is the reference broker | Go technical; show the contract + blueprints. |
| **r/opensource** | Good — Apache core, transparent open-core | Be upfront about the open-core model. |
| **r/SideProject** | Indie-friendly, forgiving of self-promo | Tell the solo-dev story. |
| **r/projectmanagement** | Your end users | Strict on self-promo — read rules, may need a flair/mod approval. Frame as "a free tool for X". |
| **Hacker News — Show HN** | Technical reach | Flat, factual tone; no marketing words. |

**Etiquette that matters more than the copy:** read each sub's rules first (many
enforce a ~9:1 self-promo ratio); disclose authorship in line one; post to *one*
place at a time and engage every comment for a few hours before the next; use the
right flair; Tue–Thu ~8–10am US Eastern lands best; reply to everything,
especially criticism.

---

## 3. Reddit posts

### r/selfhosted · r/opensource

**Title:** *I built a programme-management dashboard with no database — your existing tools stay the source of truth, nothing ever syncs (one neutral broker, n8n by default)*

> Hey all — solo dev here. I kept hitting the same wall: teams run Jira *and*
> OpenProject *and* a bit of ServiceNow, and there's no single view across them
> without a painful migration. So I built OmniProject.
>
> It's a **read-through overlay** for programme & project management, and the key
> idea is that **it stores no data of its own.** Your existing tools stay the
> system of record; every read and write is brokered live through **one neutral
> broker — n8n by default** — so if the broker can reach it, OmniProject can
> federate it. There's no copy, so there's nothing to fall out of sync.
>
> **What it does**
> - One view across multiple backends (Jira, OpenProject, GitHub, GitLab, Azure
>   DevOps, ServiceNow, Asana, Monday… and the big ERPs)
> - Programme rollup → portfolio RAG/health → drill into a project
> - Finance (Earned Value CPI/SPI, multi-currency), time/Gantt, resource
>   capacity & over-allocation — shown where a backend supplies the data
> - Methodology views: Kanban / Scrum / Gantt / PRINCE2 / RAID / list over one
>   dataset
> - OIDC SSO + RBAC, real-time notifications, full action audit
> - Ships as **one container** on port 3000; runs in demo mode with zero config
>
> **Stack:** TypeScript, React 19, Express, n8n. Importable workflow blueprints
> included so you're not wiring nodes by hand.
>
> **On trusting it with real data:** it stores nothing, and *you* control what it
> can do — because you write the broker workflow. Wire only the read actions and
> it's physically read-only against your backend; there's a dry-run verify mode, a
> sandbox, and one-click rollback. Start read-only, add writes when you trust it.
>
> It's **open-core — Apache-2.0** for everything above; a few enterprise extras
> (white-labeling, outbound webhooks, SAP/Primavera workflow generators) need a
> licence key. **Pre-1.0, provided as-is (no warranty)** — I'm launching to get
> real feedback and start a community.
>
> Repo: `<your link>` — would genuinely love your thoughts on the
> stateless / broker-agnostic approach (n8n as the reference broker). What
> backends should I add next?

### r/n8n

**Title:** *A project-management overlay that stores zero data — n8n is the reference broker for its entire integration layer. No DB, no sync drift*

> Built an open-source PM/programme dashboard that brokers everything through a
> single neutral seam, **with n8n as the reference broker**. The gateway holds no
> data; it sends a normalized contract (`{action, payload, userContext}`) to one
> webhook, and your n8n workflow maps it to whatever backend you've wired — Jira,
> OpenProject, SAP, etc. The user's own OIDC token is forwarded so writes happen
> *as the user* (real per-user audit, not a shared admin key).
>
> Ships with importable n8n workflow blueprints + a generator for ~15 backends, an
> idempotency/loop-guard contract, and a verify mode that probes your broker
> without touching the backend. Apache-2.0 core.
>
> Because the workflow *is* the integration, you control exactly what it can do —
> wire only the read actions and it's physically read-only against your backend.
>
> Repo: `<your link>` — curious what the n8n crowd thinks of this pattern.

### Hacker News — Show HN

**Title:** *Show HN: OmniProject – a programme-management overlay with no database (one neutral broker, n8n by default)*

> OmniProject is a read-through overlay for programme & project management that
> stores no data of its own. Your existing tools (Jira, OpenProject, ServiceNow,
> SAP, …) stay the system of record; every read and write is brokered through one
> neutral broker (n8n by default), so anything the broker can reach can be
> federated and there's no cached copy to drift.
>
> It does programme rollup + portfolio health, finance (EVM/CPI/SPI,
> multi-currency), time/Gantt and resource capacity, and renders the same dataset
> as Kanban / Scrum / Gantt / PRINCE2 / RAID. OIDC + RBAC, real-time
> notifications, audit. One container on port 3000; demo mode needs zero config.
>
> Stack: TypeScript, React 19, Express, n8n (the reference broker). Apache-2.0 core
> with a small licensed-feature tier. Pre-1.0, no warranty. Feedback very welcome —
> especially on the stateless, broker-agnostic architecture (n8n as the reference broker).
>
> Safe to evaluate against real systems: it persists nothing, and since the broker
> workflow is the integration, wiring only read actions makes it physically
> read-only. Dry-run verify, sandbox, and one-click rollback are built in.
>
> Repo: `<your link>`

---

## 4. GitHub release note — 0.1.0

Paste as the Release body when tagging `0.1.0`. (Template — adapt per release.)

> ## OmniProject 0.1.0 — first public release
>
> A **read-through overlay** for programme & project management with **no database
> of its own** — your tools stay the single source of truth, and everything flows
> through **one neutral broker, with n8n as the reference default**. Nothing is
> copied, so nothing drifts.
>
> ### Highlights
> - **Programme management** — programme/portfolio rollup (RAG/health) with
>   drill-down; finance (Earned Value CPI/SPI, multi-currency), time/Gantt, and
>   resource capacity/allocation — shown where a backend supplies the data.
> - **Backend-agnostic federation** — Jira, OpenProject, GitHub, GitLab, Azure
>   DevOps, ServiceNow, Asana, Monday, Trello, Wrike, ClickUp, and the large ERPs
>   (SAP, Primavera, Dynamics 365, MS Project) via declarative manifests + a
>   workflow generator.
> - **Methodology views** — Kanban / Scrum / Gantt / Waterfall / PRINCE2 / RAID /
>   list over one dataset.
> - **Exports & BI** — CSV / XLSX / PDF / Markdown / JSON, OData v4, Prometheus.
> - **Identity & access** — OIDC SSO (Auth Code + PKCE) with JWKS verification,
>   RBAC, read-only API tokens.
> - **Real-time** SSE notifications (in-process or Redis), configurable audit,
>   config snapshots + versioned rollback.
> - Ships as **one container** on port 3000.
>
> ### Premium (open-core)
> White-label branding, company-nomenclature overrides, outbound webhooks, and
> enterprise-ERP workflow generation are gated by a time-limited, Ed25519-signed
> licence key. Everything else is free.
>
> ### Quick start (demo mode, zero config)
> ```bash
> pnpm install
> PORT=8080 node artifacts/api-server/dist/index.mjs
> ```
> See [`.env.example`](../../.env.example) to connect n8n + SSO, and
> [docs/TECHNICAL.md](../TECHNICAL.md) for the architecture and n8n contract.
>
> ### Licensing & status
> Core **Apache-2.0**; premium components under the **OmniProject Premium
> License**. **Pre-1.0 and provided as is, without warranty.** No formal support
> yet — help is best-effort via issues/discussions. See
> [LICENSING.md](../../LICENSING.md).
>
> **Full changelog:** [CHANGELOG.md](../../CHANGELOG.md)

---

## 5. Pre-launch checklist

- [ ] Set the GitHub **About** blurb (one-liner above) + topics
      (`project-management`, `n8n`, `self-hosted`, `open-core`, `typescript`).
- [ ] Add a **screenshot / GIF** to the README (biggest single lift for a visual
      product) — record it with [DEMO-SCRIPT.md](DEMO-SCRIPT.md) (~75s hero +
      12s loop; the Verify-goes-green shot is the money beat).
- [ ] Enable **Discussions** and **private security advisories** in repo settings
      (issue templates already link to them).
- [x] Tag **`0.1.0`** / **`0.2.0`** and cut the Releases (note above).
- [ ] Final secret sweep (working tree + history) — done once; re-check if new
      commits added config.
- [ ] **Flip the repo public** (one-way door; history is clean).
- [ ] Post to **one** channel, engage, then space out the rest.

> **Tip:** when a commenter or pilot asks "is it safe to point at prod?", link
> [docs/SAFE-FIRST-RUN.md](../SAFE-FIRST-RUN.md) — the demo → read-only →
> verify → sandbox → add-writes on-ramp. It converts "they say it's safe" into a
> path they can follow.
