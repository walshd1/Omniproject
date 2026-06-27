# Per-broker build templates

One template per broker in the registry (`@workspace/backend-catalogue`'s
`brokerCatalogue()`, `build` field). They all implement the **same** broker
binding — the design principle is **build on the generic core, add only what's
platform-specific**:

| Broker | `build` | Template | Reuses the Node core? |
| --- | --- | --- | --- |
| n8n | `workflow-generator` | `lib/n8n-generator.ts` (generated workflow) | n/a — generates a workflow |
| **serverless** | `function-template` | `serverless-function.ts` | **Yes** — imports `processBrokerCall` |
| **Pipedream** | `component-template` | `pipedream-component.ts` | **Yes** — imports `processBrokerCall` |
| **http-sidecar** | `implement-blueprint` | `../reference-broker-blueprint.ts` | **Yes** — it *is* the core |
| Make | `scenario-template` | `make-scenario.md` | No — visual runtime, mirrors the structure |
| Power Automate | `flow-template` | `power-automate-flow.md` | No — cloud-flow runtime, mirrors the structure |
| Airflow | `dag-template` | `airflow-dag.py` | No — async/batch, **not a live data hop** (scheduled sync) |

## The shared core

`broker/reference-broker-blueprint.ts` exports **`processBrokerCall(input,
backend)`** — the transport-agnostic binding engine (parse + PSK decrypt + verify
short-circuit + the full action router + the error taxonomy). Every **Node-runtime**
broker is then a few lines: map the platform's request to `{ rawBody, actionHeader,
authHeader }`, call `processBrokerCall`, map the result back. **No duplication of
the binding logic** — change the core once, every Node broker follows.

The Node-HTTP server (`createReferenceBrokerBlueprint`), the serverless handlers,
and the Pipedream component are all the *same* adapter shape over that one core.

## The non-Node templates

Make, Power Automate and Airflow run in their own runtimes, so they can't import
the Node core — they **mirror the same binding structure** against the single
source of truth (`docs/BROKER-HTTP-BINDING.md`). Airflow is honest about being
**async**: it does scheduled sync / event push, not the synchronous read-through
hop (it's `synchronous: false` in the broker registry).

To make any template real: implement `backend` (start from the blueprint's stub),
deploy, set `BROKER_URL`, run the conformance suite.
