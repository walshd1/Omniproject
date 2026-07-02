# Licensing & the open-core model

OmniProject is **open-core**. The core is permissively licensed and free; a small
set of premium features is source-available but requires a paid licence key to
run in production. This page explains how that works in practice — including how
the paid features live in a public GitHub repo without being given away.

> **Pre-community period: premium is free to run, and enforcement is dormant —
> deliberate and temporary.** Every premium feature is granted by default (set
> `PREMIUM_ENFORCEMENT=on` to restore the paywall), and the payment-provider
> plumbing has been removed from the default runtime. The licence machinery
> stays in the code and re-activates when enforcement returns. The rest of this
> page describes the enforced model that returns later.

## Two licences

| Scope | Licence | What it means |
| ----- | ------- | ------------- |
| **Core** (the overlay, gateway, SPA, n8n contract, all standard backends) | **Apache-2.0** ([`LICENSE`](LICENSE)) | Free for any use, including commercial. Permissive, with a patent grant and an explicit *no-warranty* clause. |
| **Premium components** (white-label branding, company nomenclature, outbound webhooks, enterprise backend workflows) | **OmniProject Premium** ([`licenses/PREMIUM.txt`](licenses/PREMIUM.txt)) | Source-available; using the **features in production** needs a valid licence key (dormant during the pre-community period — see the note above). Evaluation is free. |

Premium source files are tagged in their header:

```ts
/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 */
```

## How paid features ship in a public repo

The paid code is **in the repo, in the open** — we don't hide it. Enforcement is
not obscurity, it's two layers:

1. **Runtime entitlement.** Every premium feature checks for a valid,
   unexpired, cryptographically-signed licence key (Ed25519) before it does
   anything. No key → the feature is off and the API returns `402 Payment
   Required`. The key can't be forged or extended without the issuing private
   key, and it self-expires. See [`license.ts`](artifacts/api-server/src/lib/license.ts).
2. **Licence terms.** `licenses/PREMIUM.txt` makes it a breach to strip the gate
   and run the result in production. Permissive Apache-2.0 covers the core; it
   explicitly does **not** extend to the premium-tagged files.

This is the same pattern used by GitLab, Sentry and others: transparent source,
commercial terms + a licence check on the paid bits. A determined user *can*
fork and remove the check — open-core accepts that. The model works because the
buyers (companies who want white-labeling, SIEM webhooks, and SAP/Primavera
integrations) value a supported, licensed, untampered build far more than the
cost of the key.

### Building an official vs. a community build

There is **one codebase and one build** — premium features are present in every
build and simply stay locked without a key. Operators enable them by setting
`LICENSE_KEY`. There is no separate "EE" artifact to maintain.

## Issuing licences

Licence keys are minted with [`scripts/src/mint-license.ts`](scripts/src/mint-license.ts)
from the vendor's Ed25519 issuing key (`LICENSE_PRIVATE_KEY`) — a signed,
self-expiring token, no order database, the gateway stays stateless.

> During the pre-community period the automated payment-provider plumbing
> (Stripe/Gumroad checkout webhooks → automatic minting/fulfilment) has been
> **removed from the runtime**, since premium is free and there is nothing to
> sell yet. When enforcement returns, fulfilment can be re-introduced as a thin
> route over the same `mint-license.ts` machinery.

## Licensed features vs. professional services

Two different things are sometimes both "paid", and OmniProject keeps them
strictly separate:

| | **Premium features** | **Professional services** |
| --- | --- | --- |
| **What you pay for** | The *right to run* gated code (branding, webhooks, enterprise workflows) in production. | Our *time and expertise* to build something for you. |
| **Enforcement** | A runtime licence-key gate (`402` without a key). | None — there's nothing to unlock. |
| **Example** | White-label branding. | "Build us a view for our in-house methodology." |

**Building methodology views is a service, never a locked feature.** The entire
view layer (`lib/views.ts`, `components/views/`, the registry) is **Apache-2.0
core, ungated, and fully documented** — see
[docs/METHODOLOGIES.md → Adding a new view](docs/METHODOLOGIES.md#adding-a-new-view-for-a-new-methodology).
Anyone can write their own view; nothing about *how* to build one is black-boxed.

If a customer would rather not write it themselves, we can offer to **build the
view for them as a paid engagement** — but that's us selling effort, not selling
access. The mechanism stays open whether or not you buy the service, and a view
we build for you ships as ordinary Apache-2.0 source you own and can modify. This
is deliberately the opposite of the premium gate: services are optional
convenience on top of an open capability, not a paywall around it.

### The same line runs through n8n workflows

Workflow building draws the boundary in exactly the same place — and it's worth
being precise, because workflows touch *all three* categories:

- **The tools to build workflows are open** (Apache-2.0, ungated). The workflow
  generator (`lib/backend-catalogue/src/n8n-generator.ts`), the per-backend
  manifest library (`lib/backend-catalogue/src/backend-catalogue.ts` + the
  vendor JSON), the n8n contract, the `verify-workflow` probe, and the
  ability to hand-write or generate a workflow for any **standard** backend
  (Jira, GitHub, GitLab, Azure DevOps, OpenProject, Plane, ServiceNow, Asana,
  Monday, Trello, Wrike, ClickUp) are free. So is **adding your own backend** —
  drop a backend JSON file in and the generator/wizard/verifier pick it up. See
  [docs/N8N-WORKFLOWS.md](docs/N8N-WORKFLOWS.md) and [docs/BROKER.md](docs/BROKER.md).
- **Only the prebuilt *enterprise* workflows are a licensed feature.** Generating
  the ready-to-import workflows for the heavyweight backbones (SAP S/4HANA, Oracle
  Primavera P6, Microsoft Dynamics 365 / Project) is the `enterprise_workflows`
  entitlement — `POST /api/setup/generate-workflow` returns `402` for those
  backends without a key. You're paying for the *prebuilt integration* so you
  don't have to build it, **not** for the right to build a workflow: nothing stops
  you wiring SAP yourself with the same open generator and the generic "Enterprise
  backbone" preset.
- **Bespoke workflow building is a service**, just like views — if you'd rather we
  build and tune a workflow for your backend, that's a paid engagement selling our
  time, and what we deliver is ordinary open source you own.

In short: **the prebuilt enterprise integrations are paywalled; the tools,
contract, and docs for building workflows are not.**

> **What paying does *not* currently buy: a warranty or a fix-it guarantee.**
> Concretely: you can build a SAP connector yourself for free if you'll invest
> the effort; buying the licence gives you our prebuilt SAP workflow so you don't
> have to. But today that licence entitles **use**, not support — the premium
> components are licensed **AS IS**, with **no warranty, maintenance, uptime, or
> SLA** commitment (premium licence §5–§6). If the prebuilt integration breaks, we
> help on a **best-effort, community basis**; a maintained, "if-it-breaks-it's-on-us"
> enterprise tier (paid support + SLA) is a **planned future offering, not a
> current promise**. See [Status & warranty](#status--warranty).

## Status & warranty

OmniProject is pre-1.0 and provided **AS IS, without warranty of any kind** (see
the no-warranty clauses in both licences). A licence key entitles *use* of the
premium features; it does **not** include support or any service-level
commitment. **Paid support packages are planned** as a separate offering as the
community grows — until then, help is best-effort and community-based.
