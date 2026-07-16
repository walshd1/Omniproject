# Reference designs

Plain, copy-pasteable **JSON reference designs** for building your own OmniProject
primitives and JSON defs. They live here in the repo — **outside the running system** — so
anyone can read, copy, and adapt them without touching code. Add a new one by dropping a
`.json` file into the right subfolder; there is nothing to compile.

Each file is a self-contained reference design:

```jsonc
{
  "title": "A short human title",
  "summary": "What you'll learn from this example",
  "notes": ["Field-by-field annotations…"],
  "example": {
    "kind": "primitive | report | screen | dashboard | form | jsonDef | plugin | template",
    "name": "…", "publisher": "…", "version": "1.0.0",
    "description": "…", "tags": ["…"],
    "payload": { "…": "the pure-JSON building block itself" }
  }
}
```

The `example` is a **complete registry submission** — POST it to `/api/registry` (or paste
it into the registry submit form) and it works as-is: it lands as a `draft`, and an admin
approves it for org-wide reuse.

## Folders

| Folder | Kind | Payload is… |
| --- | --- | --- |
| `primitives/` | `primitive` | a drop-in primitive definition (e.g. a chart `PrimitiveDef`) |
| `screens/` | `screen` | a screen definition (panels) |
| `forms/` | `form` | an intake form (typed fields → work item) |
| `reports/` | `report` | a custom report (query + visualisation) |
| `dashboards/` | `dashboard` | a widget grid |

## The published guarantee

These files can't rot into invalid examples: a test
(`artifacts/api-server/src/__tests__/registry-reference.test.ts`) reads **every** file in
this directory and holds it to the real submit sanitiser, and the screen/form examples to
the very validators the product enforces (`validateScreenDefs` / `validateForms`). A
reference design that would be rejected by the product fails CI here first.

## How the app serves them

The API exposes them read-only at `GET /api/registry/reference` (and
`/api/registry/reference/:slug`) by **loading these files from the repo** — they are the
source of truth, not a code module. The registry UI's reference panel reads that endpoint
so you can start a submission from any design in one click. See
[`docs/REFERENCE-DESIGNS.md`](../docs/REFERENCE-DESIGNS.md) for the human guide.
