# Business ruleset engine

**Extra, admin-configurable business rules** layered **on top of** the hard
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

## Configuring (admin only)

- **`GET /api/admin/ruleset`** — list rules + current modes.
- **`PUT /api/admin/ruleset`** — body `{ "no-deletes": "hard", "read-only": "off" }`.
  Admin-gated; every change is audited (`ruleset_update`).
- **Boot seed:** `BUSINESS_RULE_MODES` (JSON) sets initial modes, e.g.
  `BUSINESS_RULE_MODES='{"no-deletes":"hard","require-assignee":"warn"}'`.

Modes are in-memory config (reset on restart unless seeded by the env). Blocks and
warnings are recorded in the audit trail (`rule_block:<id>` / `rule_warn:<id>`).
