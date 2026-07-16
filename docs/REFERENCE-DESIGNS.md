# Reference designs — build your own primitives & JSON defs

OmniProject is built from **primitives** and **JSON definitions**: every screen, form,
report, dashboard, and chart is declarative config the app renders through one generic
builder. Nothing here is bespoke code — which means **you can author your own** and
contribute them to your org's [registry](./FEATURE-ROADMAP.md#35-org-registry-of-approved-bespoke-items--community-release-seam).

This page is the human-readable companion to the machine-readable reference designs the
API publishes. Each design is an **annotated, copy-pasteable example** that is guaranteed
valid — a test holds every example to the same sanitiser and def-validators the real
submit path enforces, so a published reference can never drift into a shape the product
would reject.

## Where to get them

- **API:** `GET /api/registry/reference` returns every reference design; `GET
  /api/registry/reference/:slug` returns one. (Viewer+; the `registry` feature module must
  be enabled.)
- **Source of truth:** `artifacts/api-server/src/lib/registry-reference.ts`.

Each design has: a `slug`, a `title`, the registry `kind` it teaches, a `summary`, an
array of teaching `notes`, and an `example` — a **complete registry submission**. To use
one, `POST` its `example` to `/api/registry` (or paste it into the submit form): it works
as-is, lands as a `draft`, and an admin approves it for org-wide reuse.

## The submission envelope

Every registry item — whatever its kind — is submitted with the same envelope:

```json
{
  "kind": "primitive | report | primitive | plugin | screen | dashboard | form | jsonDef",
  "name": "A human name",
  "publisher": "Who authored it",
  "version": "1.0.0",
  "description": "What it is (optional)",
  "tags": ["searchable", "labels"],
  "payload": { "...": "the pure-JSON building block itself" }
}
```

The `payload` is the building block; its shape depends on the `kind`. The reference
designs below show a real, valid payload for each.

## The kinds

| kind | payload is… |
| --- | --- |
| `primitive` | a drop-in primitive definition (e.g. a chart `PrimitiveDef`) |
| `jsonDef` | a raw JSON def (a screen, a methodology bundle, …) |
| `screen` | a screen definition (panels) |
| `form` | an intake form (typed fields → work item) |
| `report` | a custom report (query + visualisation) |
| `dashboard` | a widget grid |
| `plugin` | an extension manifest (typed contributions — see the marketplace) |

## Published references

### 1. A visualisation primitive (`primitive-viz-chart`)

Add a new chart type as pure JSON. It appears in the builder palette and in reports with
**no code change** — the renderer already exists; you are only describing which inputs it
takes.

Key fields: a unique kebab-case `id`, a `category` (palette group), an optional
`chartType` (the ChartView spec it draws through), and `params` (the authoring inputs —
each `key`/`label`/`type`/`required`/`description`; `type: "rows"` takes tabular data,
`"series"` picks which keys to plot).

### 2. A screen definition (`jsondef-screen`)

Compose a screen from panels. Stored org-wide, merged over the built-in catalogue (org id
wins), rendered by the generic builder.

Key fields: an `id` (targets a built-in to override, or names a new screen) + `label` +
an ordered `panels` array. Each panel needs a unique `id` and a `kind` (a registered panel
renderer); anything else on a panel (`source`, `config`, `title`) passes through to the
renderer. An unknown panel kind degrades to a labelled placeholder, so defs are
forward-compatible.

### 3. An intake form (`jsondef-form`)

Author a request/intake form; each submission becomes a work item through the broker.

Key rules: each field has `key`/`label`/`type` (one of text, textarea, number, date,
select, checkbox, email, url) and must `mapTo` a writable issue field. **Exactly one**
field maps to `title`; `description`/`labels` may be shared, every other target is scalar.
Choice types need `options`. `target.kind` is `issue`; `target.projectId` is bound by an
admin before the form accepts submissions.

### 4. A custom report (`report-custom`)

Define a report as a declarative `query` (entity + grouping + measure) plus a `viz` that
names a **primitive** id and maps query columns onto its inputs. Because it references a
primitive rather than embedding a chart, the report inherits primitive improvements
automatically.

### 5. A dashboard (`dashboard-grid`)

Lay out a dashboard as a grid of `widgets`; each has a unique `id`, a `kind`
(metric/report/chart), a `source`, and a grid `layout` (x/y/w/h). Widgets reference other
registry items by id (e.g. a report), so a dashboard **composes** curated building blocks
rather than re-defining them.

## Why this is safe

Registry items are **pure JSON, never executable code**. A `primitive`, `screen`, `form`,
`report`, or `dashboard` is data the app already knows how to render; installing one is a
governance decision (submit → admin review), not a deploy. The same forward-compatible,
degrade-gracefully validation that guards shipped defs guards yours.

## Contributing to the community

Once an item is approved, an admin may **optionally release it to the community**. Today
that marks the item `community` locally (queued); when an online marketplace is connected,
released items publish outward through the `community-marketplace` connector seam. Your
org stays in control: nothing leaves without an explicit admin release.
