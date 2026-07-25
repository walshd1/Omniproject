# Rule builder — comparison rules & the screen-scoped field picker

**Status:** design note (not yet implemented). Scopes two extensions to the admin
business-ruleset authoring surface. Companion to the ruleset engine
(`artifacts/api-server/src/lib/ruleset.ts`), the predicate language
(`lib/predicate.ts`), and the field catalogue (`lib/backend-catalogue/src/field-vocabulary.ts`,
`docs/FIELD-CATALOGUE.md`).

---

## 1. Context — the ruleset today

The **business ruleset** is the admin-configurable layer that TIGHTENS (never grants)
domain writes, evaluated after the hard gates (RBAC, scope, content validation) in
`evaluateRuleset(ctx)` (`lib/ruleset.ts:211`). It has two authoring mechanisms:

- **Built-in rules** (`BUSINESS_RULES`, `ruleset.ts:60`) — fixed predicates an operator
  toggles between `hard` / `warn` / `off`. One of them, **`due-after-start`**
  (`ruleset.ts:80`), is a *cross-field date comparison* — "an issue's due date must not
  fall before its start date" — hardcoded as a bespoke predicate because the field-rule
  mechanism can't express it.
- **Field rules** (`FieldRule`, `ruleset.ts:100`) — admin-authored JSON, *presence only*:
  `{ id, action, field, whenPresent?, mode, message? }`. "field X must be present for
  action Y", optionally "…only when field Z is present". Authored via
  `PUT /admin/ruleset/fields` (`routes/ruleset.ts:54`), seeded from `BUSINESS_FIELD_RULES`.

Everything is **restrict-only** (a rule can `hard`-block or `warn`, never allow) and
**tighten-only across scope** — org < programme < project layers may raise a rule's mode
or add rules, never drop or loosen one (`lib/ruleset-scope.ts`, `resolveEffectiveRuleset`).

Two gaps motivate this note:

1. **You can't author a comparison.** "Due date must be after start date", "target date
   must be on or after today", "actual ≤ budget" — all need a *value/field comparison*, but
   the only admin-authored rule is presence. The one comparison that exists is welded into
   code (`due-after-start`), against the house rule *"data is JSON; code is code"*
   (DESIGN-PRINCIPLES §2).
2. **The field picker is a flat list.** Authoring a rule today means picking a field key
   from *every* field in the catalogue. An operator building a rule for "screen 1" has to
   know which of ~N fields actually appear there. The builder should filter the offered
   fields to the ones a chosen screen surfaces.

This note designs both, keeping the restrict-only + tighten-only + data-not-code invariants.

---

## 2. Part A — Comparison rules (generalise `due-after-start`)

### 2.1 The shape

Add a third admin-authored rule type alongside `FieldRule` — a **`ComparisonRule`** — a
restrict-only cross-field / field-vs-value comparison:

```ts
interface ComparisonRule {
  id: string;
  /** Exact action ("create_issue", "update_task") or "any-write". */
  action: string;
  /** The left-hand field key (a canonical field, see §3.2). */
  field: string;
  /** The comparison. Date/number aware; see the operator table below. */
  op: "after" | "on-or-after" | "before" | "on-or-before"
    | "equals" | "not-equals" | "greater-than" | "greater-or-equal"
    | "less-than" | "less-or-equal";
  /** The right-hand side: ANOTHER field, or a literal value. Exactly one. */
  rhs: { field: string } | { value: string | number };
  mode: RuleMode;                 // hard | warn | off
  /** When present, the rule only applies if this field is set (like FieldRule.whenPresent). */
  whenPresent?: string;
  message?: string;
}
```

This directly generalises `due-after-start`, which becomes the authored rule
`{ action: "any-write", field: "dueDate", op: "on-or-after", rhs: { field: "startDate" } }`.

The **`rhs` union is the crux** — it covers both the user's phrasings:

- **field-vs-field** — "due date must be **after** *start date*" → `rhs: { field: "startDate" }`.
- **field-vs-value** — "target date must be **on or after** *2026-01-01*" ("date must be
  anytime after …") → `rhs: { value: "2026-01-01" }`.

### 2.2 Operators — aligned to the existing predicate language

The predicate engine (`lib/predicate.ts:21`) already ships the primitive operators
`eq | ne | gt | gte | lt | lte | in | nin | …` and the field-type-aware numeric coercion we
need. `ComparisonRule.op` is a **UX-friendly alias layer** over those primitives, resolved
by field type (dates coerce to epoch-ms via the existing `asTime`, `ruleset.ts:52`):

| Author picks (`op`) | date fields | number/currency/percent | primitive |
| --- | --- | --- | --- |
| after / before | strictly later / earlier | greater-than / less-than | `gt` / `lt` |
| on-or-after / on-or-before | ≥ / ≤ by date | greater-or-equal / less-or-equal | `gte` / `lte` |
| equals / not-equals | same instant | same number; also strings/enums | `eq` / `ne` |

Alias names are chosen by the **left field's type** (§3.2): a `date` field offers
after/before/on-or-after…; a `number`/`currency` field offers greater-than/…; an
`enum`/`string` field offers equals/not-equals only. This is what turns "date must be after
X" into a guided choice rather than a free-form predicate string.

> **Reuse, don't fork.** `ComparisonRule` should compile *down to* a `Predicate`-shaped
> check so the field-vs-value case shares `evaluatePredicate` (`predicate.ts:49`) and its
> coercion rules. The one thing `Predicate` lacks is a **field reference on the RHS** — today
> `value` is always a literal. The minimal extension is to let the evaluator resolve
> `rhs.field` from the same context object before comparing. Keep the primitive `Op` set
> unchanged; add only the alias resolution + RHS-field lookup.

### 2.3 Where it runs

`evaluateRuleset(ctx)` gains a third loop, after the built-ins and the presence field rules
(`ruleset.ts:221`–`238`), iterating the effective `comparisonRules`:

1. skip if `mode === "off"`;
2. skip if `action` doesn't match (`fr.action === ctx.action || (fr.action === "any-write" && ctx.write)`, exactly as field rules, `ruleset.ts:231`);
3. skip if `whenPresent` is set and absent (dependency not triggered);
4. resolve LHS = `ctx.payload[field]`, RHS = `rhs.field ? ctx.payload[rhs.field] : rhs.value`;
5. if either side is missing/uncoercible, **skip** (a comparison over absent data never
   blocks — presence is the `FieldRule`'s job, not this one);
6. evaluate the aliased operator; on **failure** of the asserted relation:
   `hard` → block (`{ allow: false, blocked }`), `warn` → push a warning.

Restrict-only holds by construction: the rule only ever produces a block or a warning.

### 2.4 Authoring, persistence, scope

- **Authoring:** extend the existing field-rule surface rather than adding a new noun.
  `GET/PUT /admin/ruleset/fields` (`routes/ruleset.ts:51`) already replaces the whole
  authored set wholesale; widen its payload to `{ fieldRules: FieldRule[]; comparisonRules: ComparisonRule[] }`
  (back-compat: a bare `FieldRule[]` body keeps working, comparison set defaults to `[]`).
  Validate each with an `isComparisonRule` guard mirroring `isFieldRule` (`ruleset.ts:130`):
  known op, `field`/`rhs` well-formed, valid mode — malformed entries dropped + logged, never
  granting.
- **Persistence:** same path as field rules — env seed (`BUSINESS_FIELD_RULES` gains a
  sibling, or a combined `BUSINESS_RULES_JSON`) + in-memory + scoped-config overrides. Not
  in the encrypted def store (these are governance config, not tenant data).
- **Scope layering:** `tightenFieldRules` (`ruleset-scope.ts:43`) extends to comparison
  rules — a programme/project override may **add** a comparison rule or **raise** its mode,
  never drop or weaken one. Tighten-only is preserved end to end.
- **Retire the hardcode:** once comparison rules exist, delete the built-in `due-after-start`
  predicate and ship it instead as a **default in the reference-ruleset bundles**
  (`referenceRulesetCatalogue`, applied via `POST /admin/ruleset/apply-reference`). Net effect:
  one fewer bespoke predicate in code, the same behaviour expressed as data (DESIGN-PRINCIPLES §2).

---

## 3. Part B — the screen-scoped field picker

> *"When building rules it should filter so that when you pick screen 1 you get presented
> only with the fields on that screen to pick from."*

### 3.1 The gap

There is **no screen→fields index today.** A screen def (`RawScreenDef` /
`OrgScreenDef`, `lib/screen-def.ts:19`) is `{ id, label, panels[] }`; each panel is
`{ id, kind, config? }` with **opaque `config`**. The canonical field metadata lives
*separately* in the field vocabulary (`FIELD_REGISTRY`, `CANONICAL_FIELD_KEYS`,
`field-vocabulary.ts:86`). Nothing maps a screen to the field keys it renders — so the picker
can't filter by screen without new wiring.

### 3.2 The field catalogue is already typed — lean on it

Each field is a `FieldDescriptor { key, label, type, group?, core?, references?, entity?, … }`
(`field-vocabulary.ts:56`), `type ∈ string | text | number | date | enum | user | labels |
reference | currency | percent | boolean | duration`. The api-server already collapses these
to a coarse `FieldKind = "number" | "date" | "string"` for validation
(`lib/field-validation.ts:55`).

This metadata is what makes the builder *guided*, and it powers **both** features:

- **operator menu** — the LHS field's `type` selects the alias set (§2.2): `date` → after/before/…, `number|currency|percent|duration` → greater-than/…, `enum|string|user|boolean` → equals/not-equals.
- **RHS "other field" menu** — for a field-vs-field comparison, offer only fields of the
  **same `FieldKind`** (compare dates to dates, numbers to numbers). Prevents nonsense rules
  at authoring time instead of silently skipping at eval time.
- **labels** — show `descriptor.label`, not the raw `key`.

### 3.3 The resolver to build

Introduce `fieldsForScreen(screenId, scope): FieldDescriptor[]`:

1. resolve the merged screen def for the caller's scope
   (`resolveScreenDefs(req, { projectId })`, `lib/screen-store.ts:19` — legacy < org < project < user);
2. walk its `panels[]` and collect the field keys each panel references. **This needs a
   convention** the panels don't yet guarantee: a field-bearing panel should expose its keys
   in a readable slot — e.g. `panel.config.fields: string[]` (or a typed `kind: "fields"`
   panel). Panels without it contribute nothing.
3. intersect the collected keys with `CANONICAL_FIELD_KEYS` (drop anything not a real field)
   and map to `FieldDescriptor`s via `FIELD_REGISTRY`.

Expose it read-only for the builder, e.g. `GET /api/screens/:id/fields` (pmo — same authority
as the ruleset editor), returning `[{ key, label, type, kind }]`.

> **Dependency / phasing note.** Step 2 is the real work: today panel `config` is opaque
> passthrough, so *most* screens won't yield fields until field-bearing panels adopt the
> `config.fields` convention. Until then `fieldsForScreen` returns a partial (often empty)
> set. So the picker must **degrade gracefully** (§3.4), and adopting the convention on the
> core field panels is a prerequisite for the screen filter to be useful — track it
> explicitly rather than assuming the index exists.

### 3.4 The picker flow (and its escape hatch)

1. Author opens the rule builder → optional **"scope to screen"** selector (lists
   `screenDefCatalogue()` + org/project overrides).
2. Pick a screen → field menu filters to `fieldsForScreen(screenId, scope)`.
3. Pick a field → operator menu constrained by its `type` (§3.2); for a comparison rule the
   RHS "other field" menu is constrained to same-kind fields.
4. **Escape hatch:** an **"all fields"** toggle bypasses the screen filter (for cross-screen
   or backend-only fields), and a screen that surfaces no indexable fields shows the full
   catalogue with a hint rather than an empty list. The filter is an authoring *aid*, never a
   *gate* — a rule can still target any canonical field.

Screen scoping is **presentational only**: it narrows what the author is *offered*, it does
**not** attach the rule to a screen or change evaluation. Rules still match on `action` +
field presence in the write payload, exactly as today. (A future extension could persist the
authoring screen as metadata for "show me the rules relevant to this screen", but that's out
of scope here.)

---

## 4. Combined data model

```ts
// The authored business-ruleset payload (PUT /admin/ruleset/fields), widened:
interface AuthoredRuleset {
  fieldRules: FieldRule[];            // presence + dependency (unchanged)
  comparisonRules: ComparisonRule[];  // NEW — §2.1, restrict-only, tighten-only
}

// Read-only, for the builder's screen filter (GET /api/screens/:id/fields):
interface ScreenField { key: string; label: string; type: FieldType; kind: "number" | "date" | "string" }
```

Invariants carried forward from the existing ruleset:

- **Restrict-only** — no rule type can `allow`; `hard` blocks (422), `warn` headers, `off` is inert.
- **Tighten-only across scope** — overrides may add/raise, never drop/lower (comparison rules included).
- **Data, not code** — comparison rules are JSON; `due-after-start` retires from code into a bundle.
- **One choke point** — everything still funnels through `evaluateRuleset` + `enforceBusinessRules`; no route re-implements a comparison.

---

## 5. Phasing

1. **Comparison rules, engine + authoring** — `ComparisonRule`, the third `evaluateRuleset`
   loop, `isComparisonRule` validation, widen `PUT /admin/ruleset/fields`, extend
   `tightenFieldRules`. Ship `due-after-start` as a bundle default and delete the built-in.
   *Self-contained; no screen work needed.*
2. **Typed field metadata for the builder** — surface `FieldDescriptor.type`/`kind` +
   labels to the authoring UI so operators and RHS targets are type-constrained. *No new
   backend model — reads `FIELD_REGISTRY`.*
3. **Screen→fields index** — adopt the `panel.config.fields` convention on the core
   field-bearing panels, add `fieldsForScreen` + `GET /api/screens/:id/fields`, wire the
   picker's screen filter with the "all fields" fallback.

Phase 1 delivers the user-visible win ("date must be after X") on its own; phases 2–3 make
authoring guided and screen-aware.

## 6. Open questions

- **Combined vs. separate authored sets** — widen `PUT /admin/ruleset/fields` to carry both
  rule kinds (recommended, one atomic replace) vs. a new `/admin/ruleset/comparisons` route.
- **RHS literal typing** — should a date literal be an ISO string only, or also accept
  relative tokens ("today", "+7d")? Relative tokens are powerful but need a fixed evaluation
  clock (mirror the software-update signing concern about deterministic time).
- **Panel field-key convention** — is `config.fields: string[]` the right slot, or should
  field-bearing panels become a first-class `kind: "fields"` with a typed config? The latter
  is cleaner but touches the screen importer/validator (`validateScreenDefs`, `screen-def.ts:31`).
- **Cross-entity fields** — `FieldDescriptor.entity` scopes some fields to a noun; should the
  builder filter by the rule's `action` entity as well as by screen?
