# Per-broker build templates

One template per broker in the registry (`@workspace/backend-catalogue`'s
`brokerCatalogue()`, `build` field). They all implement the **same** broker
binding — the design principle is **build on the generic core, add only what's
platform-specific**:

| Broker | `build` | Template | Reuses the Node core? |
| --- | --- | --- | --- |
| n8n | `workflow-generator` | `lib/n8n-generator.ts` | n/a runtime — but **same separation**: one shared scaffold (webhook → verify → route → respond) + per-backend mappings |
| **reference-sidecar** | (CI fixture) | `../reference-sidecar.ts` | **Yes** — `processBrokerCall` core + an in-memory `BrokerBackend` |
| **serverless** | `function-template` | `serverless-function.ts` | **Yes** — imports `processBrokerCall` |
| **Pipedream** | `component-template` | `pipedream-component.ts` | **Yes** — imports `processBrokerCall` |
| **http-sidecar** | `implement-blueprint` | `../reference-broker-blueprint.ts` | **Yes** — defines the core |
| Make | `scenario-template` | `make-scenario.md` | No — visual runtime, mirrors the structure |
| Power Automate | `flow-template` | `power-automate-flow.md` | No — cloud-flow runtime, mirrors the structure |

> **Airflow is not a broker.** It can't serve the synchronous read-through hop, so
> it lives in the **outputs** plane as a scheduled `batch-egress`
> (`vendors/outputs/airflow.json`), not here. The `airflow-dag.py` sample remains as
> a reference for that scheduled egress (read the OData/BI feeds on a schedule), not
> as a broker build template.

Every Node-runtime broker — the runnable **reference-sidecar**, the blueprint, the
serverless + Pipedream templates — now shares the **one** `processBrokerCall` engine
and differs only in (a) its `backend` implementation and (b) ~15 lines of transport
glue. Change the binding once, every Node broker follows. n8n (a different runtime)
keeps the same *shape* via its generator's shared scaffold.

## The shared core

`broker/reference-broker-blueprint.ts` exports **`processBrokerCall(input,
backend)`** — the transport-agnostic binding engine (parse + PSK decrypt + verify
short-circuit + the full 24-action router + the error taxonomy). It is **generalised
so a provider isn't neutered**: the backend gets the full control surface (the
actor + token, `source` routing, `idempotencyKey`, `origin`), the complete action
set, and the result carries an `encrypted` flag so the transport can reply
PSK-symmetrically. Every **Node-runtime** broker is then a few lines: map the
platform's request to `{ rawBody, actionHeader, authHeader }`, call
`processBrokerCall`, map the result back. **No duplication of the binding logic.**

The Node-HTTP server (`createReferenceBrokerBlueprint`), the serverless handlers,
and the Pipedream component are all the *same* adapter shape over that one core.

## The non-Node templates

Make and Power Automate run in their own runtimes, so they can't import the Node
core — they **mirror the same binding structure** against the single source of
truth (`docs/BROKER-HTTP-BINDING.md`). Airflow isn't a broker at all: it can't
serve the synchronous read-through hop, so it's modelled in the outputs plane as a
scheduled `batch-egress` (the `airflow-dag.py` sample shows that scheduled read).

To make any template real: implement `backend` (start from the blueprint's stub),
deploy, set `BROKER_URL`, run the conformance suite.
