# ADR 0001 — Extract a broker boundary; n8n becomes an implementation

- **Status:** Accepted
- **Date:** 2026-06-24

> **Update (0.2.0):** the de-n8n-ing of the public surface that this ADR defers to
> a "later, aliased migration" has since shipped. Stage B renamed the surface with
> deprecated aliases; Stage C (released in **0.2.0**) removed the aliases entirely.
> The frozen names called out under *Negative / trade-offs* and *Alternatives
> considered* below (`/n8n-proxy`, `n8nWebhookUrl`, `N8N_WEBHOOK_URL`) **no longer
> exist** — the canonical names are `/api/broker/command`, `brokerUrl`, and
> `BROKER_URL`. The decision below is preserved as the original record.

## Context

OmniProject is a stateless overlay: it owns no data and brokers every read and
write to backend systems of record. n8n is the broker. Our positioning explicitly
claims we can "re-architect if n8n is superseded" — but in the v0.1 code that
claim was only an *intention*. n8n specifics had leaked: a `callN8n` choke point
existed, but the demo-vs-n8n decision, n8n action strings, source labels, the
webhook envelope, and the `N8nError`/`N8nResult` shapes were referenced directly
across ~10 modules (route handlers, `data.ts`, `capabilities.ts`, `currency.ts`,
`portfolio.ts`). Demo mode was a parallel code path interleaved into every
caller, not an adapter. Nothing prevented further coupling from accreting.

## Decision

Introduce a single **`Broker` interface** in OmniProject's domain vocabulary
(`src/broker/types.ts`) and route everything above it through `getBroker()`.
Provide two implementations:

- **`N8nBroker`** — the one real adapter; ALL n8n specifics live here.
- **`DemoBroker`** — the fake adapter; demo mode now *is* this, not a parallel
  branch.

Add an **architecture guard test** that fails CI if n8n leaks above the seam
(n8n-free data path + no legacy n8n call API + no direct adapter imports). Freeze
the small set of n8n names already shipped in the public API/UI as the adapter's
documented external edge, rather than make a breaking change at v0.1.x.

This was a pure, behaviour-preserving extraction: the same API surface, the same
n8n wire contract, the same demo experience (97 prior unit tests + the live n8n
contract verification stay green).

## Consequences

**Positive**
- All backend-churn risk is concentrated behind one swappable seam. Replacing or
  retiring n8n is now "implement one class + flip the selector"; the data path,
  API, SPA, and tests above the seam are untouched.
- The guard makes the boundary a property the build *enforces*, not a convention
  a future shortcut can quietly erode.
- Demo mode is a real adapter, so the whole app provably runs offline with no n8n
  installed or configured — a clean CI/eval harness.

**Negative / trade-offs**
- A small set of frozen public names (`/n8n-proxy`, `n8nWebhookUrl`,
  `N8N_WEBHOOK_URL`) still names n8n. Fully de-n8n-ing them is a breaking API/UI
  change deferred to a later, aliased migration (Stage B).
- The generic command escape hatch (`command()`) can still carry arbitrary action
  strings; that is deliberate (the command palette needs it) and stays inside the
  adapter.

## Alternatives considered

- **Do nothing** — leave the `callN8n` choke point and the scattered demo
  branches. Rejected: the claim "n8n is swappable" would remain unverified and
  coupling would keep accreting.
- **Add a second real broker now** (Temporal/Windmill/…) to prove portability.
  Rejected as out of scope and a maintenance burden; the `DemoBroker` already
  proves the seam, and the guard prevents regressions without a second backend.
- **Rename the public surface now** (`/broker/command`, `brokerUrl`). Rejected
  for v0.1.x: it breaks the shipped API and SPA with no functional gain; deferred
  behind deprecated aliases.

See [docs/BROKER.md](../BROKER.md) for the contract and boundary invariants.
