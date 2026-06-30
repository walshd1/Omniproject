# Feature gating & governance model

How an organisation controls **which features, methodologies, and reports** are available, across the
**org → programme → project** hierarchy — and how a PMO **mandates** ("must use") or **forbids**
("must not use") them through the business-ruleset engine.

## The catalogue

The gated catalogue spans three item kinds, addressed uniformly by id:

- **features** — the toggleable modules (`feature-modules.ts`): grid, savedViews, presence, …
- **methodologies** — the methodology plane (PRINCE2, Scrum, SAFe, …).
- **reports** — the report surfaces (Monte Carlo, EVM, Benefits Realisation, …).

Core, always-on routes (auth, projects/issues, the broker seam) are **not** gateable.

## Two strengths of policy

| Strength | Verb | Who | Effect |
| --- | --- | --- | --- |
| **soft** | `disable` / `enable` | each level | everyday narrowing — a level removes an item for itself + descendants; a `defaultOff` item needs an explicit org `enable` (opt-in) |
| **hard** | `require` / `forbid` | PMO via ruleset engine (`hard` mode) | a **mandate**: forced on / forced off, and **locked** so descendants can't override it |

`warn` mode (advisory) is the ruleset engine's middle setting: the item stays available but the choice
is flagged in governance output — useful for "we prefer X" without hard-locking it.

## Resolution (monotonic narrowing — org is the ceiling)

For each catalogue item, resolve top-down; the first rule that fires wins:

1. **org `forbid`** → off, locked@org.
2. **org not-allowed** (default-off & not opted in, or org-disabled, and not org-required) → off@org.
3. **org `require`** → on, locked@org (a mandate; overrides default-off).
4. **programme** `forbid` → off locked · `require` → on locked · `disable` → off — all within the org grant.
5. **project** `forbid` → off locked · `require` → on locked · `disable` → off — within the programme grant.
6. otherwise → on.

Because every step is bounded by the previous, **a lower level can never mandate something its parent
forbade or never allowed**. A standalone project (no programme) is gated directly under the org.

Mapping to RBAC roles: **admin → org**, **pmo → programme**, **manager → project**.

## How a PMO authors it (the ruleset-engine tie-in)

A PMO doesn't edit lists by hand — they express governance as **rules** in the existing restrict-only
business-ruleset engine (`lib/ruleset.ts`, modes `hard | warn | off`):

- *"Every project here must use PRINCE2"* → `require methodology:prince2` at programme scope, `hard`.
- *"We must not use the Monte Carlo report"* → `forbid report:monteCarlo` at org scope, `hard`.
- *"Prefer the editable grid"* → `enable feature:grid` advisory, or `warn` if discouraged elsewhere.

These compile into the per-scope `required` / `forbidden` / `enabled` / `disabled` sets the resolver
consumes. The engine's existing guarantee carries over: governance can only **tighten**, never grant a
privilege or loosen a hard gate (RBAC + capability gates still run first).

## Storage & enforcement

- **Overrides live in the existing encrypted config bundle** (config-as-folder-of-JSON), keyed by
  `programmeId` / `projectId` — OmniProject config, not customer data, so no new store. (Per the stateful
  policy in `PARKED-DECISIONS.md §0`.)
- **Enforcement depth:** UI gating for cosmetic items; **server-side** (`requireFeature` made
  scope-aware, and the ruleset engine at action time) for the cost/safety/storage and the hard
  mandates — so a forbid actually stops the broker load / blocks the action, not just hides a button.

## Status

- **Shipped:** the pure resolver (`feature-resolution.ts`) with soft narrowing + hard require/forbid
  locking and the `defaultOff`/`reason` registry metadata; the per-scope config schema + scoped
  `GET /api/features?programmeId=&projectId=` with `PUT /api/features/programme|project/:id`
  (ceiling-checked server-side); scope-aware `requireFeature`; the unified **governance catalogue**
  spanning features ∪ reports (`report:<id>`) ∪ methodologies (`methodology:<id>`), each carrying its
  `kind`; and the **3-level admin UI** (`FeatureGovernance`) where admin/pmo/manager each see only what
  their parent allows, grouped by catalogue plane. `FeatureModulesAdmin` covers the module toggles only.
