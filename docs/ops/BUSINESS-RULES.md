# Business ruleset engine

**Extra, PMO-configurable business rules** layered **on top of** the hard
ruleset. Each rule has a mode:

| Mode | Effect |
| --- | --- |
| **`hard`** | **block** the action (HTTP `422`, `{ error, rule }`) |
| **`warn`** | allow, but record a warning (audit + `X-OmniProject-Rule-Warnings` header) |
| **`off`** | not enforced (the default for every rule) |

## The safety guarantee — it can only tighten, never loosen

This is the critical property: the business ruleset **cannot undermine the hard
ruleset** (RBAC, capability gating, the contract guards).

1. **It runs *after* the hard gates.** Each write handler calls `requireRole(...)`
   (hard) first; the business ruleset is evaluated only once that has passed. So
   the hard gates always run, regardless of any business rule.
2. **It is restrict-only.** A rule can only **deny** (`hard`) or **warn** — there
   is **no mode that grants**. The config API accepts only `hard | warn | off` and
   only known rule ids; you cannot author a predicate or add an "allow".
3. **`off` disables that business rule only.** It never touches RBAC or any hard
   guarantee. A viewer still can't write with every business rule off — RBAC stops
   them, not this engine.

In short: the engine adds restrictions a business wants (freeze a portfolio, ban
deletes, require an assignee) **without** becoming a way to escalate privilege.

## Built-in rules

Operators toggle the **mode**; the predicates are fixed (no code injection):

| Rule | Applies to | Default |
| --- | --- | --- |
| `read-only` | every write (a portfolio freeze) | off |
| `no-deletes` | `delete_*` actions | off |
| `require-assignee` | create/update issue with no assignee | off |
| `require-description` | create issue with no description | off |
| `due-after-start` | create/update issue where `dueDate` < `startDate` | off |

`due-after-start` is a **cross-field comparison** — the kind of soft policy that
otherwise gets baked into code. It lives as a fixed built-in (not a field rule,
which can only check presence), still off by default and still restrict-only.

## Field rules — "what must go in fields" + dependencies

Beyond the built-ins, the PMO can author **field rules** (data, not code — just
field-presence, so still restrict-only):

- **Required field** — *"no task can be created without an effort estimate"*:
  ```json
  { "id": "require-estimate", "action": "create_issue", "field": "estimateHours", "mode": "hard" }
  ```
- **Dependency** — *"cost centre is required when an item is billable"* (only
  enforced when the trigger field is present):
  ```json
  { "id": "cc-when-billable", "action": "create_issue", "field": "costCenter", "whenPresent": "billable", "mode": "warn" }
  ```

`action` is an exact action (`create_issue`, `update_issue`, …) or `"any-write"`.
A `hard` field rule returns `422`; a `warn` records a warning. Field rules can only
**require** a field — never grant — so the safety guarantee above still holds.

## Configuring (PMO governance)

The business ruleset is **programme-management governance**, so it is gated at the
**`pmo`** authority — the PMO owns the business rules. `pmo` and `admin` are
**orthogonal** authorities (governance vs technical), so a *pure* admin does **not**
pass these endpoints, and a *pure* PMO does not pass the technical ones. Someone who
holds **both** clears both. See [RBAC roles](ROLES.md) / `lib/rbac.ts`.

- **`GET /api/admin/ruleset`** — list rules + current modes.
- **`PUT /api/admin/ruleset`** — body `{ "no-deletes": "hard", "read-only": "off" }`.
  PMO-gated; every change is audited (`ruleset_update`).
- **`GET/PUT /api/admin/ruleset/fields`** — read / replace the field rules (the
  PUT body is the full array). PMO-gated + audited (`ruleset_fields_update`).
- **Boot seed:** `BUSINESS_RULE_MODES` (JSON) for built-in modes, and
  `BUSINESS_FIELD_RULES` (JSON array) for field rules, e.g.
  `BUSINESS_FIELD_RULES='[{"id":"require-estimate","action":"create_issue","field":"estimateHours","mode":"hard"}]'`.

Modes are in-memory config (reset on restart unless seeded by the env). Blocks and
warnings are recorded in the audit trail (`rule_block:<id>` / `rule_warn:<id>`).

## Reference rulesets — compliance baselines per methodology

To help a PMO get compliance + completeness right without hand-building rules,
OmniProject ships a curated **reference ruleset** per methodology (Scrum, Kanban,
Scrumban, Waterfall, PRINCE2, SAFe). Each is a *named bundle* of built-in modes +
field rules — e.g. Scrum warns on missing assignee/description and nudges a
story-point estimate; Waterfall hard-requires start/finish dates so a task can be
baselined. They live in the catalogue (`lib/backend-catalogue/src/methodology-rulesets.ts`)
as data, so they carry **every safety guarantee of the engine** — applying one can
only tighten, never grant.

- **`GET /api/admin/ruleset/reference`** — list the reference bundles (PMO-gated).
- **`POST /api/admin/ruleset/apply-reference`** — body `{ "methodology": "scrum" }`.
  Applies the bundle **deterministically** (every unlisted built-in resets to off,
  the field-rule set is replaced) through the same restrict-only `setRuleModes` /
  `setFieldRules` path. PMO-gated + audited (`ruleset_apply_reference`).

These are *reference* mappings — sensible defaults to review and tune for your
programme, not law.
