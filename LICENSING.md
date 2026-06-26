# Licensing & the open-core model

OmniProject is **open-core**. The core is permissively licensed and free; a small
set of premium features is source-available but requires a paid licence key to
run in production. This page explains how that works in practice — including how
the paid features live in a public GitHub repo without being given away.

## Two licences

| Scope | Licence | What it means |
| ----- | ------- | ------------- |
| **Core** (the overlay, gateway, SPA, n8n contract, all standard backends) | **Apache-2.0** ([`LICENSE`](LICENSE)) | Free for any use, including commercial. Permissive, with a patent grant and an explicit *no-warranty* clause. |
| **Premium components** (white-label branding, company nomenclature, outbound webhooks, enterprise backend workflows, licence fulfilment) | **OmniProject Premium** ([`LICENSE-PREMIUM.txt`](LICENSE-PREMIUM.txt)) | Source-available; using the **features in production** needs a valid licence key. Evaluation is free. |

Premium source files are tagged in their header:

```ts
/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by LICENSE-PREMIUM.txt, NOT Apache-2.0.
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
2. **Licence terms.** `LICENSE-PREMIUM.txt` makes it a breach to strip the gate
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

## Buying & fulfilment (automated, support-free)

Purchases are fully automated so a solo maintainer never runs a support desk:

```
buyer → Stripe / Gumroad checkout → webhook → gateway mints a signed key
      → POSTs it to LICENSE_FULFILLMENT_URL (an n8n workflow) → emails the buyer
```

- `POST /api/licensing/stripe` and `POST /api/licensing/gumroad` verify the
  provider's signature, map the purchased product to an entitlement
  (`LICENSE_PRODUCTS`), mint an Ed25519 key, and hand it to your fulfilment
  workflow. No order database — the gateway stays stateless.
- Use a **merchant-of-record** (Lemon Squeezy, Polar, Paddle, or Gumroad) to
  have VAT/sales tax handled for you.

See [docs/TECHNICAL.md → Premium overlay](docs/TECHNICAL.md#premium-overlay-licensed-features)
for the env vars and the full flow.

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

## Status & warranty

OmniProject is pre-1.0 and provided **AS IS, without warranty of any kind** (see
the no-warranty clauses in both licences). A licence key entitles *use* of the
premium features; it does **not** include support or any service-level
commitment. **Paid support packages are planned** as a separate offering as the
community grows — until then, help is best-effort and community-based.
