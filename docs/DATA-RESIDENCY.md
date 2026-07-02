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

There are two forms. The **flat env pair** is the original single-deployment model. The **JSON
policy** is the richer per-country/region form for multinationals — it supersedes the pair when set
and additionally governs **egress**.

| Env | Meaning |
| --- | --- |
| `DATA_RESIDENCY_POLICY` | A JSON per-country policy (see below). **Supersedes the two below when set.** Unset ⇒ this layer is inert. |
| `DATA_RESIDENCY_ALLOWED` | Comma list of allowed region codes, e.g. `eu` or `eu,uk`. **Unset ⇒ enforcement OFF.** |
| `DATA_RESIDENCY_MAP` | Comma list of `urlPrefix=region` pairs, e.g. `https://eu.n8n.example=eu,https://us.n8n.example=us`. An endpoint takes the region of its **longest** matching prefix. |

Example — an EU-only deployment with two regional brokers wired (flat form):

```bash
DATA_RESIDENCY_ALLOWED=eu
DATA_RESIDENCY_MAP="https://eu.n8n.example=eu,https://us.n8n.example=us"
BROKER_ENDPOINTS="jira=https://eu.n8n.example/webhook/omni"
```

A command that resolves to `https://us.n8n.example/...` is refused (`451`) and audited; one that
resolves to the EU endpoint proceeds.

## Per-country / per-region policy (multinationals)

A single deployment can serve several jurisdictions, each **pinned to its own backends and its own
egress hosts**. Set `DATA_RESIDENCY_POLICY` to a JSON document mapping `region → { backends, egress }`:

```json
{
  "regions": {
    "eu": { "backends": ["https://eu.n8n.example"], "egress": ["*.eu.example.com", "idp.eu.example"] },
    "us": { "backends": ["https://us.n8n.example"], "egress": ["*.us.example.com"] }
  },
  "allowed": ["eu"]
}
```

- **`regions`** — each region/country code maps to its allowed broker **`backends`** (URL prefixes,
  longest-prefix wins, exactly like `DATA_RESIDENCY_MAP`) and its allowed **`egress`** host patterns.
  An egress pattern is an exact host (`idp.eu.example`) or a `*.suffix` wildcard (`*.eu.example.com`,
  which also matches the apex `eu.example.com`). A region's own backend hosts are **implicitly**
  egress-allowed, so you needn't restate them.
- **`allowed`** — the region codes this deployment permits. **Omit** it to allow every declared
  region. A code not declared in `regions` is a validation error (you can't allow what you didn't
  define).

**Two enforcement seams** (both fail-closed) when a policy is active:

1. **Broker hop** — the resolved endpoint pool is checked exactly as before, but region and allow-set
   come from the policy.
2. **Egress hop** — *every* outbound request (`assertEgressAllowed`, so broker, IdP, FX, AI, logging)
   must target a host in an **allowed** region's egress allowlist, else it is refused with a `451`
   `DataResidencyError` and a `data_residency.egress_block` audit event. This is why non-broker hosts
   (IdP, FX, AI providers) must be listed under a region's `egress`.

**Fail-closed on an invalid policy.** If `DATA_RESIDENCY_POLICY` cannot be parsed or fails validation,
the guard refuses *everything* — a policy it cannot read cannot prove residency.

### Validating a policy before you deploy it

Because the overlay is stateless (config lives in the environment, read live), a policy is applied by
setting the env var. To catch a fail-closed typo first, an admin can dry-run the exact validator:

```
POST /api/security/data-residency/validate      (admin + step-up)
Body: the candidate policy JSON
→ 200 { ok: true, regions: [...], allowed: [...] }   or   400 { ok: false, issues: [...] }
```

## Visibility

`GET /api/security/data-residency` (admin) returns the active policy and, for every configured
broker endpoint, its **origin** (the secret webhook path is redacted), declared region, and allow
verdict — so an operator can confirm the posture before relying on it. The response carries a
`mode` (`policy` | `env` | `off`); in `policy` mode it also lists each declared region's backends,
egress patterns, and allow verdict, and surfaces a `policyError` when the policy is failing closed.

## Scope (honest)

- The **flat env** form enforces only the **broker hop**. The **JSON policy** form additionally
  enforces the **egress hop** for every outbound request (IdP, logging-sync, FX, AI-provider), so a
  per-country policy can partition those too — provided their hosts are listed under a region's
  `egress`. (Those subsystems keep their own controls as well; residency is an outer fail-closed net.)
- Region tagging is by **URL prefix**, so each region must terminate at a distinct
  origin/prefix. Co-mingled endpoints on one origin can't be distinguished.
- Region selection is **per-deployment**: the `allowed` set says which regions this instance may
  reach. Per-*request* country routing (a request tagged `DE` that may reach only EU infrastructure)
  is the next step — the policy language and both seams are already in place; only the request-context
  region selector would be added. When multi-tenancy lands, `allowed` extends to a per-tenant region
  via the tenant context.
