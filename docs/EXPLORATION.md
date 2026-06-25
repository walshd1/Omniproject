# Exploration mode — snapshots, what-if & dependency modelling

OmniProject stores nothing and the gateway stays **stateless and zero-data-at-rest**.
That is a feature for the *live* app — but it means there is no obvious home for the
things you sometimes want to do *around* a portfolio: trend a few months of
captures, sketch a "what if we slip project X" scenario, or note that an item in one
system blocks an item in another. **Exploration mode (`/explore`)** is that home.

It is a deliberately distinct, **"NOT LIVE DATA"** surface — a hazard-striped lab
ribbon, kept visually and structurally separate from the live app so a modelled or
historical figure can never be mistaken for production reality. Everything in it is:

- **Client-side and session-volatile.** Snapshots, scenarios and dependency edges
  live in the browser's `sessionStorage`. There is **no broker call and no contract
  change** — the gateway never sees any of it.
- **Download to keep, or discarded at session end.** A "Download exploration"
  control and a native leave-warning fire while there is undownloaded work; close
  the tab and anything you didn't export to a JSON file on your own disk is gone.

> **Maturity: Beta.** Exploration mode and its four tools are functional and
> covered by unit/component tests, but they are **new and not yet hardened by
> real-world use**. See [Maturity & known limitations](#maturity--known-limitations)
> below, and the [CHANGELOG `[Unreleased]`](../CHANGELOG.md) for the canonical
> wording.

---

## Provenance — nothing here is presented as backend fact

OmniProject badges every figure with its provenance so a model is never shown as
recorded reality. The badges you will see in Exploration mode:

| Badge | Meaning |
| ----- | ------- |
| `captured` | A trend point built from a snapshot **you captured in the browser** — not backend-recorded history. |
| `sample` | **Demo data.** When a capture was taken in demo mode, its points are sample data, badged accordingly. |
| `derived` | A figure computed from backend data (e.g. an aggregate), not read verbatim. |

The time-travel scrubber (also surfaced in `/explore`) adds two further lanes —
`replayed` (a real recorded state read back from an operator-owned logging server)
and `projected` (a model of the future, never fact). Those belong to the
**Experimental** time-travel feature; see [TIME-TRAVEL.md](TIME-TRAVEL.md).

---

## The four tools

### 1. Portfolio snapshots → trends

**What it does.** Captures the live read-model (per-project issue/completed counts,
plus portfolio RAG / schedule-variance / budget-variance / blocker rows) at 1..N
points in time. A trend chart is then derived **purely client-side** across those
captured points — completion %, average schedule/budget variance, active blockers,
or projects at RED. Captures are trimmed to only the fields a trend needs; no full
issue content is kept.

**Client-side / session-volatile.** Captures are held in `sessionStorage`
(cleared on tab close). The gateway never receives a snapshot.

**Download or discard.** Export a snapshot **bundle** (a JSON file) to your own disk
for durable, cross-session, multi-month trends; re-import it next session to keep the
series going. Without that export, the captures vanish at session end.

**Provenance.** Trend points are badged `captured` (or `sample` if captured in demo
mode), so a browser-built series is never mistaken for backend-recorded history.

**Status: Beta.** New; render- and unit-tested but not yet proven across long
real-world use.

### 2. Auto-snapshot schedule

**What it does.** Captures on a fixed interval until an end date/time, so you can
walk away and collect a short series without clicking each time.

**Client-side / session-volatile.** It is a **browser timer, not a server cron**:
the schedule config lives in `sessionStorage` (a refresh resumes it within the same
session).

> **Limitation (specific):** the schedule **runs only while the tab is open.** It is
> not a durable historian — for an overnight/over-weekend cadence that survives a
> closed laptop, use the n8n snapshot-historian / logging-server path (see
> [TIME-TRAVEL.md](TIME-TRAVEL.md) and [BROKER.md](BROKER.md)), which is the
> server-side, durable equivalent.

**Status: Beta.**

### 3. What-If sandbox

**What it does.** Forks the portfolio read-model into local copies and applies a few
**coarse, portfolio-level levers** per project — shift completion by N percentage
points, add/remove schedule-variance days, nudge budget variance, add/remove
blockers — then shows the **baseline-vs-scenario delta** across completion, average
schedule/budget variance, total blockers and RAG counts.

The baseline can be the **live** portfolio *or* **any captured snapshot**, so a
what-if can be reproduced against a fixed point in time. "Capture as snapshot" writes
the adjusted figures back into the (browser-only) snapshot store, so a scenario can
feed the trend view.

**Client-side / session-volatile.** Pure, in-browser maths over copies — inputs are
never mutated, there is **no broker call and no persistence**. Reset or close the tab
and it is discarded; nothing is ever written back to a backend.

> **Limitation (specific):** it is **coarse and portfolio-level** — a handful of
> additive levers over aggregate figures. It is a **modelling aid, not a planner**:
> no per-issue scheduling, no dependency-aware critical path, no new fields.

**Status: Beta.**

### 4. Cross-system dependency links — by hash only

**What it does.** Records that an item in one system relates to / depends on / blocks
an item in another (e.g. a Jira issue blocks a ServiceNow change). To keep
OmniProject from quietly becoming a *shadow* PM store, an edge deliberately holds
only:

- **two SHA-256 content fingerprints** (one per endpoint, computed at assert time)
  — **never the content itself**; and
- the **minimal references** needed to re-read each endpoint live (system,
  project ref, item ref) plus an optional short note.

No titles, statuses, descriptions or other project content are stored. Everything
shown about an endpoint is re-read **live** through the broker; OmniProject only
remembers "these two fingerprints are linked." A "hash-only" anti-creep test guards
against content ever sneaking into an edge.

**Drift detection.** Re-reading an endpoint and re-hashing its material fields tells
you *if* it changed since the link was asserted (a review prompt) — without ever
storing what it was.

**Client-side / session-volatile.** Edges live in `sessionStorage` and export to a
JSON file for durability; the gateway stores nothing.

> **Limitation (specific):** **drift only recomputes for endpoints whose projects
> are currently loaded** in the session. An edge to an item you haven't loaded won't
> show fresh drift until that endpoint is read again.

**Status: Beta.**

---

## Maturity & known limitations

Exploration mode is **Beta** — client-side, session-volatile, new, and **not yet
battle-tested**. In plain terms:

- It is **not a system of record.** Nothing here is durable unless *you* download it;
  the gateway stays stateless and zero-data-at-rest.
- Figures are **models, not backend fact**, and are badged (`captured` / `sample` /
  `derived`) accordingly.
- Per-tool limits, restated: auto-snapshot runs **tab-open only**; the what-if
  sandbox is **coarse and portfolio-level**; dependency drift recomputes **only for
  currently-loaded endpoints**.
- It is covered by unit/component tests (the pure snapshot/scenario/dependency maths,
  and the surface's render behaviour), but several flows are render-tested rather
  than fully interaction-tested. See [TESTING.md](TESTING.md).

For the durable, server-side counterparts (a real historian and replay), the
**Experimental** time-travel path is the right tool — with its own, stronger caveats.

---

See also: [TIME-TRAVEL.md](TIME-TRAVEL.md) · [BROKER.md](BROKER.md) ·
[TESTING.md](TESTING.md) · [CHANGELOG.md](../CHANGELOG.md).
