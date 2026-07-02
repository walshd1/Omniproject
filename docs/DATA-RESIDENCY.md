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

`GET /api/capabilities` (any authenticated user) also carries a reduced, non-sensitive `residency`
field (`{ enabled, allowedRegions }` — region **codes** only, never URLs/secrets), so a report that
needs to gate a cross-border action doesn't need admin access to know the posture. The
cross-programme resource-levelling report (`docs/FUNCTION-MAP.md` →
`artifacts/omniproject/src/lib/resource-levelling.ts`) is the first consumer: it reuses this SAME
allowed-region set to refuse modelling a move for a resource whose declared `country` (a new
optional `ResourceCapacity` field a broker may set) is outside it, or undeclared while enforcement
is on — fail-closed, exactly like an endpoint with no declared region.

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

## Cross-instance federation (backlog #135)

Per-country residency (above) naturally pushes a multinational toward running **one OmniProject
instance per region/subsidiary** — each pinned to its own jurisdiction's backends. That leaves no way
to see a consolidated *global* portfolio, since each instance only ever sees its own connected
backends. Federation closes that gap with the **same posture** the rest of this document describes:
only a **pre-aggregated summary** ever crosses an instance boundary — never a raw project or issue
record.

**What crosses the boundary:**

- `GET /portfolio/summary`'s response — `PortfolioSummary` (`artifacts/api-server/src/lib/portfolio-summary.ts`):
  a portfolio-wide project **count**, RAG **counts**, averaged schedule/budget **variances**, a total
  blocker **count**, a consolidated finance **total** (budget/actual/forecast/earned-value/variance/CPI
  in one reporting currency), and a consolidated capacity **total** (allocations/hours/utilisation).
  Every field is a total or count over the WHOLE portfolio — never a project id/name, a programme
  id/name, or a person's name.

**What never crosses the boundary:**

- Any individual project, issue, task, RAID entry, resource name, or programme breakdown. The
  per-project `PortfolioHealthSummary` rows `GET /portfolio/health` already serves locally are folded
  into portfolio-wide counts (`summarizeHealth`) BEFORE the federation endpoint is reached — a peer
  calls `/portfolio/summary`, never `/portfolio/health` or any per-project route.
- Peer **credentials**. A peer's bearer token is config (`settings.federatedPeers`, masked on read
  like a webhook secret) and is never itself surfaced in a report.

**How the fan-out is authorised.** This instance calls a peer's `GET /portfolio/summary` with a plain
bearer token that must be one of the **peer's own** `API_TOKENS` (`lib/api-token.ts`) — the read-only
API-token scheme that already exists for BI-style consumers. No new cross-instance auth scheme was
added; this instance is simply another read-only API-token client of the peer.

**How it's kept honest in the view.** `GET /federated-portfolio` never blends peer figures into one
number: the response is this instance's own summary (`local`) plus an array of per-peer results
(`peers`), each carrying the peer's id/label/region and a `status` (`ok` / `unreachable` /
`unauthorized` / `error`). An unreachable or misconfigured peer renders as a labeled "unavailable"
contribution — it is EXCLUDED from any total, never silently folded in as zero, and never fails the
rest of the view (mirrors the outbound-webhook delivery fan-out's per-target error handling and an
FX-rate fallback: one bad target degrades gracefully, it doesn't take down the read).

**Statelessness preserved.** Nothing is cached or stored beyond the peer **config** itself (a base URL
+ a credential per peer — config, exactly like a webhook subscription, not project data). Every
federated view re-fans-out live; there is no federation cache or background sync job.

**Relationship to the residency gate above.** The broker/egress residency guard governs calls OUT to
a *backend* (Jira, ServiceNow, …) and is about which jurisdiction's data may leave via that specific
hop. Federation is a distinct, explicit, admin-configured channel between two OmniProject instances
themselves — the same trust class as the opt-in logging-sync egress (`docs/DATA-RESIDENCY.md`'s
sibling doc on webhooks): it doesn't run through `assertEgressAllowed`/`assertEgressResidency`
(a peer's `baseUrl` is validated once at config-write time with the same SSRF-safety check as a
webhook URL, not re-checked per delivery), because its entire purpose is to deliberately move an
**aggregate** across a boundary those hops are built to keep raw data inside. What it does NOT do is
loosen the broker/egress guard itself — a federated peer never becomes a broker endpoint, and its
`/portfolio/summary` payload can never itself contain more than the aggregate described above.
