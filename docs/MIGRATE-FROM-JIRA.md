# Landing a Jira migration

Jira Data Center's sunset is forcing a choice on thousands of teams: move to
Atlassian Cloud, or move out. OmniProject supports a third posture most tools
can't — **you don't have to migrate to leave** — plus a clean landing path when
you do want the data out.

## Posture A — Federate: keep Jira underneath, stop living in it

OmniProject is an overlay, not a destination. Wire Jira in as a backend and the
dual-lens board, Gantt, portfolio and reporting views run **on top of your
existing Jira**, reads and writes brokered through your n8n:

1. Setup → backends → **Jira** → *Generate workflow* (or
   `POST /api/setup/generate-workflow` with `{ "backendId": "jira" }`; add
   `"readOnly": true` for a look-but-don't-touch trial).
2. Import the generated workflow into n8n, set `JIRA_INSTANCE_URL` and
   `JIRA_BASIC_AUTH` (base64 `email:api-token`) as n8n variables, activate.
3. Point OmniProject's broker URL at the workflow's webhook.

Nothing is copied, so there is no cut-over day, no dual-entry period, and no
decision deadline: Jira stays the system of record for as long as the licence
does. Writes carry the active user's context and an idempotency key (see
[TECHNICAL.md](TECHNICAL.md)); the loop guard stops webhook echo storms if you
sync Jira with a second backend during a phased exit.

## Posture B — Import: land the data

When you want records out of Jira — leaving DC without buying Cloud, or
retiring a project — use Jira's own CSV export and OmniProject's import flow.

### 1. Export from Jira

Issue search (JQL: `project = ENG ORDER BY created ASC`) → **Export → CSV (all
fields)**.

- **Data Center / Server** exports the full result set in one file.
- **Cloud** caps UI exports at 1000 rows: page with
  `ORDER BY created ASC` + a `created >=` cursor, or pull
  `/rest/api/3/search` via the generated workflow instead.

### 2. Preview and map columns

`POST /api/import/preview` with the parsed rows (or Setup → Import in the UI).
The column mapper recognises Jira's export headers out of the box:

| Jira CSV header | Canonical field | Note |
| --- | --- | --- |
| Summary | `title` | |
| Issue Type | `type` | |
| Status / Priority / Resolution | `status` / `priority` / `resolution` | statuses map onto your configured vocabulary |
| Assignee / Reporter / Labels | `assignee` / `reporter` / `labels` | |
| Component/s | `component` | |
| Fix Version/s | `fixVersion` | |
| Sprint / Epic Link | `sprint` / `epic` | |
| Due date | `dueDate` | |
| Original estimate / Time Spent / Remaining Estimate | `originalEstimateHours` / `loggedHours` / `remainingHours` | **Jira exports seconds** — divide by 3600 before import (one spreadsheet column op), or map and fix in review |
| Parent | `parentTask` | |
| Custom field (Story Points) | `storyPoints` | |
| Issue key | *(unmapped)* | `ENG-42` is Jira-local; map it to `tags` or `url` yourself if you want traceability back |

Every suggestion is confirmable before anything is written — the mapping is a
reference, not law, and unmapped columns are surfaced rather than dropped.

### 3. Commit

`POST /api/import/commit` writes each row through the same broker seam and
business ruleset as a hand-typed create — a hard-blocked row is reported, not
silently skipped. Nothing bypasses governance because it arrived in bulk.

### What a CSV does not carry

Comments, attachments, issue history, workflow schemes and Automation rules do
not survive any CSV export — that's a Jira limitation, not an import one. If
comments matter, keep posture A for the affected projects (history stays
readable in place) or archive the Jira instance read-only alongside.

## Posture C — Phased exit (recommended for DC estates)

Run A and B together: federate everything on day one (teams get one pane of
glass immediately, zero migration risk), then import projects one at a time as
their delivery allows, flipping each project's routing from the Jira workflow
to the landed copy. The `backendSource` routing hint and per-project workflows
mean half-migrated is a stable state, not an emergency.

## Also coming from MS Project?

`.mpp` plans travel via Project's MSPDI XML interchange — the catalogue ships a
parser (`parseMspdi` in `@workspace/backend-catalogue`) that feeds the same
import preview/commit flow, including WBS, predecessors and outline structure.
