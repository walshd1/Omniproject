# Roles & access (RBAC)

OmniProject is a stateless overlay — it owns no user directory. It derives a role
from the OIDC token's group/role claims and enforces a coarse gate at the gateway
(`lib/rbac.ts`). The backend systems of record still enforce their own authorization
on every brokered write (the user's own bearer is forwarded), so this gate is
defence-in-depth + UX, not the sole control.

## A linear base ladder + two orthogonal authorities

The set of roles and their gates are **fixed in code** (so the boundary stays
statically verifiable). The everyday hierarchy is a linear **base ladder**:

| Base role | Rank | Can |
| --- | --- | --- |
| `viewer` | 0 | read-only (also the role for read-only API tokens) |
| `contributor` | 1 | create/update/delete issues; tabular import |
| `manager` | 2 | + RAID, baselines, portfolio actions, field manifest |

Above `manager` sit two **independent authorities** — separate capability sets, not
a higher rung. Each implies `manager`-level base access, but **neither implies the
other**:

| Authority | Owns |
| --- | --- |
| `pmo` | **Business governance** — the business ruleset & methodology reference rulesets. The programme-management authority. |
| `admin` | **Technical config** — brokers, integrations, security, broker-log, role mapping, raw-SQL/Mongo backends. The technical authority. |

**They are orthogonal and joinable.** A person can hold neither, either, or both:

- a **pure `admin`** does *not* pass a `pmo` gate — it cannot edit business rules;
- a **pure `pmo`** does *not* pass an `admin` gate — it cannot touch technical config;
- holding **both** grants the union (map the IdP group to both lists).

This is the deliberate design: business governance and technical administration are
*different jobs*. Splitting them means your platform admin isn't automatically your
rules authority, and vice versa — least privilege by default, combined on purpose.

> **No lockout.** If a deployment maps only `admin` and forgets `pmo`, an admin can
> grant governance to someone (including themselves) via the audited role-mapping
> editor below. The grant is then *explicit and logged*, not an implicit superset.

## Mapping IdP groups to roles

The base mapping is env (comma lists), highest privilege wins:

```
OIDC_ADMIN_ROLES="omni-admins,platform-admins"
OIDC_PMO_ROLES="pmo,programme-managers"
OIDC_MANAGER_ROLES="delivery-leads"
OIDC_CONTRIBUTOR_ROLES="engineers"
OIDC_VIEWER_ROLES="stakeholders"
```

An authenticated user with no matching claim defaults to `contributor` (override
with `OIDC_DEFAULT_ROLE`). Demo sessions (no `OIDC_ISSUER_URL`) are admin.

### The role-mapping editor (admin-only)

Admins can edit the group→role mapping at runtime instead of redeploying env:

- **`GET /api/admin/role-map`** — the effective mapping + each role's source (env / override).
- **`PUT /api/admin/role-map`** — body `{ "pmo": ["programme-managers"], … }`. An
  override **replaces** the env list for that role. Admin-gated + audited
  (`role_map_update`).

By design this is a *mapping* editor, **not** a role/permission creator: it can only
assign IdP groups to the five fixed roles — unknown keys are ignored, so it can
never invent a role or grant a new permission. If a genuinely new tier is needed,
add a fixed role in code (as PMO was) with its own tested gate — keeping the hard
boundary verifiable rather than editable data.
