# Reference designs — build your own primitives & JSON defs

OmniProject is built from **primitives** and **JSON definitions**: every screen, form,
report, dashboard, and chart is declarative config the app renders through one generic
builder. Nothing here is bespoke code — which means **you can author your own** and
contribute them to your org's [registry](./FEATURE-ROADMAP.md#35-org-registry-of-approved-bespoke-items--community-release-seam).

This page is the human-readable companion to the **reference skeletons** in the repo. Each
skeleton is a heavily-commented `.jsonc` template you copy and adapt.

## Where to get them

- **The skeletons:** the commented `.jsonc` files in
  [`reference-designs/`](../reference-designs/) at the repo root. They are **pure reference
  material** — the running app **never loads, reads, or serves them**. There is no endpoint
  and no build step; add one by dropping a `.jsonc` file into the right subfolder.
- Each skeleton has the **submission envelope** + a **payload** shaped like the real thing,
  with inline `//` comments explaining every field and the `<PLACEHOLDER>` values to fill.

To use one, copy the skeleton, strip the comments, fill in the placeholders, then `POST`
the result to `/api/registry` (or paste it into the Registry submit form): it lands as a
`draft`, and an admin approves it for org-wide reuse. The submit endpoint runs the real
sanitiser + def-validators, so anything malformed is rejected there with a clear message.

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

## The skeletons

### 1. A visualisation primitive (`reference-designs/primitives/chart.primitive.jsonc`)

Add a new chart type as pure JSON. It appears in the builder palette and in reports with
**no code change** — the renderer already exists; you are only describing which inputs it
takes.

Key fields: a unique kebab-case `id`, a `category` (palette group), an optional
`chartType` (the ChartView spec it draws through), and `params` (the authoring inputs —
each `key`/`label`/`type`/`required`/`description`; `type: "rows"` takes tabular data,
`"series"` picks which keys to plot).

### 2. A screen definition (`reference-designs/screens/screen.jsonc`)

Compose a screen from panels. Stored org-wide, merged over the built-in catalogue (org id
wins), rendered by the generic builder.

Key fields: an `id` (targets a built-in to override, or names a new screen) + `label` +
an ordered `panels` array. Each panel needs a unique `id` and a `kind` (a registered panel
renderer); anything else on a panel (`source`, `config`, `title`) passes through to the
renderer. An unknown panel kind degrades to a labelled placeholder, so defs are
forward-compatible.

### 3. An intake form (`reference-designs/forms/form.jsonc`)

Author a request/intake form; each submission becomes a work item through the broker.

Key rules: each field has `key`/`label`/`type` (one of text, textarea, number, date,
select, checkbox, email, url) and must `mapTo` a writable issue field. **Exactly one**
field maps to `title`; `description`/`labels` may be shared, every other target is scalar.
Choice types need `options`. `target.kind` is `issue`; `target.projectId` is bound by an
admin before the form accepts submissions.

### 4. A custom report (`reference-designs/reports/report.jsonc`)

Define a report as a declarative `query` (entity + grouping + measure) plus a `viz` that
names a **primitive** id and maps query columns onto its inputs. Because it references a
primitive rather than embedding a chart, the report inherits primitive improvements
automatically.

### 5. A dashboard (`reference-designs/dashboards/dashboard.jsonc`)

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
