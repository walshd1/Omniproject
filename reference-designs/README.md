# Reference designs — commented skeletons

Heavily-commented **skeletons** for building your own OmniProject primitives and JSON
defs. They live here in the repo purely as reference material for admins and devs to
**copy and adapt** — the running app **never loads, reads, or serves them**. There is no
endpoint and no build step; they are documentation you can grep, diff, and clone.

Each file is a [`.jsonc`](https://code.visualstudio.com/docs/languages/json#_json-with-comments)
(JSON-with-comments) skeleton: the submission envelope, a payload shaped like the real
thing, and inline `//` comments explaining every field and the placeholders to fill in.

## How to use one

1. Copy the skeleton for the kind you want to build.
2. Strip the comments and fill in the `<PLACEHOLDER>` values.
3. `POST` the result to `/api/registry`, or paste it into the **Registry** page's submit
   form. It lands as a `draft`; an admin approves it for org-wide reuse.

## Skeletons

| File | Kind | Builds… |
| --- | --- | --- |
| `primitives/chart.primitive.jsonc` | `primitive` | a drop-in chart (a `PrimitiveDef`) |
| `screens/screen.jsonc` | `screen` | a screen definition (panels) |
| `forms/form.jsonc` | `form` | an intake form (typed fields → work item) |
| `reports/report.jsonc` | `report` | a custom report (query + visualisation) |
| `dashboards/dashboard.jsonc` | `dashboard` | a widget grid |

Each skeleton names the source-of-truth validator it must satisfy (e.g. `screen-def.ts`,
`form-def.ts`), so you can check the exact rules the product enforces on submit.

See [`docs/REFERENCE-DESIGNS.md`](../docs/REFERENCE-DESIGNS.md) for the narrative guide.
