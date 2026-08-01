# Degraded reads — what happens when a backend doesn't answer

OmniProject holds no copy of anything, so every view is a live fan-out. That is the product's central
guarantee and also its sharpest edge: a backend that fails takes its slice of the truth with it, and
there is no cache to fall back on. This page defines what the gateway does about that.

It is deliberately short on machinery. Nothing here caches, persists, or serves last-known-good
anything — a degraded read is still a live read, and the availability tally dies with the request.
Zero-at-rest is not relaxed to make this work.

## The rule

**Rows that answered are real. Totals summed across sources are not reportable unless every source
answered.**

A budget total over 3 of 4 backends is not a smaller total, it is a **wrong** one. Screenshotted into
a board pack it reads as authoritative, and nothing on the page says otherwise. So the roll-up is
withheld and the response says which sources were missing, rather than quietly publishing a number
that understates by however much the unavailable system was carrying.

This is the same principle as the provenance badges (`sourced` / `derived` / `sample`): a derived
figure is never presented as backend fact.

## What a caller sees

`GET /api/portfolio/summary` carries an `availability` block:

```jsonc
{
  "projects": 22,
  "availability": {
    "complete": false,
    "attempted": 4,
    "answered": 3,
    "unavailable": [{ "source": "project:p-8842", "reason": "financials read failed" }]
  },
  "finance": null,     // withheld: a cross-source total is wrong when a source is missing
  "capacity": null,    // withheld for the same reason
  "health": { /* … */ }
}
```

Any response whose reads were incomplete also carries the header:

```
X-OmniProject-Sources-Unavailable: 1
```

This mirrors `X-OmniProject-Data-Repaired` (see `lib/data-quality.ts`). The two are siblings and cover
the two ways a live read can disappoint you:

| | Signal | Meaning |
| --- | --- | --- |
| Data arrived, but malformed | `X-OmniProject-Data-Repaired` | the read seam repaired N fields |
| Data did not arrive at all | `X-OmniProject-Sources-Unavailable` | N sources did not answer |

A UI should render "3 of 4 sources reporting" and name the missing one, not present a partial
portfolio as the portfolio.

## How it works

Three pieces, all above the broker seam and none of them broker-aware:

- **`lib/concurrency-pool.ts` → `poolSettle` / `poolSettleWith`.** The settling counterpart to
  `poolMap`. Same bounded concurrency, but it never rejects: every item's outcome comes back in input
  order, so a caller can serve the slice that answered. `poolMap` (built on `Promise.all`) stays the
  default and stays correct for bulk **writes** and for exports that must be whole — failing loud is
  the right behaviour there.
- **`lib/read-availability.ts`.** A per-request `AsyncLocalStorage` tally, modelled directly on
  `lib/data-quality.ts`. Fan-outs call `recordAttempted` / `recordUnavailable`; aggregate producers
  call `readsWereComplete()` before publishing a figure. Failures are deduplicated on source, because
  one unreachable backend failing twenty per-project reads is one outage, not twenty.
- **Middleware in `app.ts`.** Establishes the scope and emits the header, wrapping `res.json` so the
  count is final when the body is written.

Outside a scope (a scheduled export, a unit test) `readsWereComplete()` returns `true`: a caller with
no tally has no evidence of a gap, and suppressing every total there would be worse than the status quo.

## Where it is enforced today

`lib/portfolio-summary.ts`, the highest-traffic fan-out:

| Path | Was | Now |
| --- | --- | --- |
| `listProjects` fails | degraded to `[]` ⇒ reported **`projects: 0`**, indistinguishable from a healthy empty org | recorded unavailable; `availability.complete` false |
| a project's financials fail | counted, logged server-side, total still published over the subset | total withheld |
| a project's capacity fails | caught to `[]`, indistinguishable from "no resources"; total silently covered a subset | recorded unavailable; total withheld |
| a federated peer fails | logged | also recorded, so the federated response carries the header |

`summaryHealth` and `summaryTasks` already degraded correctly (a failed section returns `null`, which
reads as absent rather than zero) and were left alone.

## Testing it — the fault injector

`broker/fault-broker.ts` makes a backend fail on demand. Without it none of this was testable: the demo
broker always answers, so "3 of 4 sources reported" could never happen. It is the sibling of
`messy-broker.ts` — that one asks how derivations cope with dirty data, this one asks how they cope
with none — and it sits innermost in the decorator chain, so an injected fault propagates up through
the sanitizer, single-flight, cache and provenance layers exactly as a real backend failure would.

In a test, via the in-process hook (no env, no config surface, the `__setEgressTransportForTest` pattern):

```ts
__setBrokerFaultsForTest({ methods: ["projectFinancials"], args: ["p-2"] });
resetBroker();                       // the chain is memoised; rebuild it after arming
// …assert the finance total is withheld and p-2 is named…
__setBrokerFaultsForTest(null); resetBroker();
```

By hand in dev, to see the degraded UI:

```bash
OMNI_DEV_MODE=1 DEV_BROKER_FAULTS='projectFinancials:p-2' pnpm --filter @workspace/api-server run dev
OMNI_DEV_MODE=1 DEV_BROKER_FAULTS='listProjects@timeout' pnpm --filter @workspace/api-server run dev
```

Two independent gates, neither reachable in production: `DEV_BROKER_FAULTS` is read only under
`isDevMode()` (false when `NODE_ENV=production`), and the test hook has no env or network surface at
all. A malformed `DEV_BROKER_FAULTS` degrades to *no* faults rather than failing everything, so a typo
in a dev shell never looks like a product bug. `fault-broker.test.ts` pins both gates.

Covered end to end in `__tests__/degraded-reads-routes.test.ts`: a failing project withholds the
finance total and names the source, a capacity failure withholds capacity, a total outage reports
unavailable rather than `projects: 0`, and the header appears only when something actually failed.

## Known gaps

- **The per-section conditions are not driven by `readsWereComplete()`.** They are local on purpose: a
  capacity read failing should not suppress a finance total that had all of its own inputs. The cost is
  that the rule lives in more than one place.
- **Only the portfolio summary is wired.** Exports, OData and the resource roster still fan out through
  `poolMap` and remain all-or-nothing. That is safe (never silently wrong), just not yet useful.
- **No per-backend health surface.** `unavailable` names the source that failed on this request; there
  is no standing "is SAP up" view.
- **The SPA does not render it yet.** The API and the header carry everything a "3 of 4 sources
  reporting" banner needs; nothing consumes them.
