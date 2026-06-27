# Tabular import — Excel / CSV with a column mapper

OmniProject can import work items from a spreadsheet (or any legacy system that
exports one) and write them into your **live backend** through the broker. It
stores nothing itself — the sheet is mapped to canonical fields and created as
issues, exactly as if you had typed them.

## The flow

1. **Upload / paste** your rows as `{ headers, rows }` (the SPA does this from an
   `.xlsx`/`.csv`; programmatic callers post JSON directly).
2. **Preview** — `POST /api/import/preview` auto-maps each column to a canonical
   field and shows how the first rows resolve.
3. **Confirm + commit** — `POST /api/import/commit` applies the (optionally edited)
   mapping and creates one issue per row via the active backend.

## The column mapper

`lib/column-mapper.ts` (pure, unit-tested) suggests a `column → canonical field`
mapping by, in order:

| Basis | Confidence | Example |
| --- | --- | --- |
| **exact** | 1.0 | `Due date` → `dueDate`, `status` → `status` |
| **synonym** | 0.9 | `Summary`/`Name` → `title`, `Owner` → `assignee`, `Deadline` → `dueDate`, `Points` → `storyPoints` |
| **fuzzy** | ≤ 0.85 | `Assigne` (typo) → `assignee` |
| none | 0 | unrecognised header → left **unmapped** |

Each canonical field is claimed by at most one column (highest confidence wins);
losers are left unmapped so nothing is silently overwritten. Unmapped columns are
**dropped**, not invented as custom fields. Values are coerced by field type
(numbers, dates → `YYYY-MM-DD`, booleans, comma/semicolon labels), losslessly —
an unparseable value is kept as text rather than nulled. These are *reference*
mappings: review and tune before committing.

## Endpoints

- **`POST /api/import/preview`** — body `{ headers?: string[], rows?: object[] }`.
  Returns `{ mapping, unmapped, preview, rowCount }`. No writes. (contributor+)
- **`POST /api/import/commit`** — body `{ projectId, rows, mapping? }`. Applies the
  mapping (auto-derived if omitted), writes each row via the broker, returns
  `{ created, skipped, fields }`. (contributor+)
  - The mapping **must** include a `title` column (the one structural requirement).
  - Each row passes through the **business ruleset** just like a single create — a
    row a hard rule blocks is **skipped with its reason**, never forced through.
  - Status: `201` when every row landed, `207` (multi-status) when some were
    skipped, `400` on a bad request, an error when nothing imported.

## Why "import" is its own backend kind

Excel/CSV appears in the backend catalogue as `kind: "import"` — it is a one-shot
source, **not** brokered live, so it lists no brokers and carries no live read
actions. The same two endpoints serve any tabular producer (a SQL/Mongo result
set, a legacy export), because the mapper only needs `{ headers, rows }`.
