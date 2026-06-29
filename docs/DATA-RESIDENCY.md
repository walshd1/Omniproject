# Data residency / region routing

A fail-closed control that guarantees work for a region never leaves it. Because OmniProject is
**stateless** (zero data at rest), the only place data crosses a boundary is the outbound broker
hop — so that hop is exactly where the boundary is enforced.

## Model

- Every configured broker endpoint is tagged with a **region** (`DATA_RESIDENCY_MAP`).
- The deployment declares the **allowed region(s)** (`DATA_RESIDENCY_ALLOWED`).
- Before any request egresses, the resolved endpoint pool is checked. A call to an endpoint
  outside the allowed set — or to one whose region is **undeclared** — is **refused with `451
  Unavailable For Legal Reasons`** and an audit event (`data_residency.block`). No bytes leave.

The check sits in the broker adapter's endpoint resolver (`webhookPool()`), the single place
*every* outbound call passes through (CRUD, per-kind routed calls, pooled/round-robin, probes).

## Fail-closed

When enforcement is enabled, the guard fails **closed**:

- An endpoint whose region is **not** in the allowed set → refused.
- An endpoint with **no declared region** → refused (an unprovable region can't be trusted).

When `DATA_RESIDENCY_ALLOWED` is unset the guard is **off** and nothing is checked — the default
deployment is completely unchanged.

## Configuration

| Env | Meaning |
| --- | --- |
| `DATA_RESIDENCY_ALLOWED` | Comma list of allowed region codes, e.g. `eu` or `eu,uk`. **Unset ⇒ enforcement OFF.** |
| `DATA_RESIDENCY_MAP` | Comma list of `urlPrefix=region` pairs, e.g. `https://eu.n8n.example=eu,https://us.n8n.example=us`. An endpoint takes the region of its **longest** matching prefix. |

Example — an EU-only deployment with two regional brokers wired:

```bash
DATA_RESIDENCY_ALLOWED=eu
DATA_RESIDENCY_MAP="https://eu.n8n.example=eu,https://us.n8n.example=us"
BROKER_ENDPOINTS="jira=https://eu.n8n.example/webhook/omni"
```

A command that resolves to `https://us.n8n.example/...` is refused (`451`) and audited; one that
resolves to the EU endpoint proceeds.

## Visibility

`GET /api/security/data-residency` (admin) returns the active policy and, for every configured
broker endpoint, its **origin** (the secret webhook path is redacted), declared region, and allow
verdict — so an operator can confirm the posture before relying on it.

## Scope (honest)

- This enforces the **broker hop** — the only egress in the stateless model. It does not partition
  an IdP, an external logging-sync target, or AI-provider egress; those are governed by their own
  controls (OIDC/SAML config, `LoggingSync`, the AI egress/governance layer).
- Region tagging is by **URL prefix**, so each region must terminate at a distinct
  origin/prefix. Co-mingled endpoints on one origin can't be distinguished.
- Single-tenant today: "allowed region" is per-deployment. When multi-tenancy lands, the same
  guard extends to a per-tenant region via the tenant context.
