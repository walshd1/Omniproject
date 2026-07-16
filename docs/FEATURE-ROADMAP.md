# Feature Roadmap — competitive gap backlog

**Purpose.** This is the durable, version-controlled backlog of features that close the
gap between OmniProject and the leading project/portfolio tools (Jira/Jira Align, Asana,
Monday, Smartsheet, MS Project, Planview/Clarity, Wrike, ClickUp, Linear, Notion). It
exists so that *whenever there is engineering capacity*, the next item can be picked up
without re-doing the analysis. Work top-down: finish a phase before starting the next,
and tick items as they land.

> **How to use this doc.** Each item has a stable `id`, a one-line rationale, the
> competitors that have it, crisp acceptance criteria, and an "architecture leverage"
> note (what existing OmniProject machinery it reuses). When you complete an item, change
> its status to ✅ **Done** with the commit/PR reference, and move the next `Todo` to
> 🚧 **In progress**. Keep the phases ordered by leverage-per-cost.

## Where OmniProject already leads (context)

OmniProject is a **stateless governance + portfolio overlay** on top of systems of record
(41 connectors), not a Jira/Asana clone. It already meets or beats the field on:

- **PPM depth** — EVM, Monte-Carlo schedule risk, critical path, capacity levelling,
  scenario/what-if, benefits realisation, stage gates, multi-currency + rate cards
  (rivals Planview/Clarity).
- **Governance & security** — passkey-signed approval chains, responsibility acceptance,
  tamper-evident audit chains, SCIM/OIDC/SAML, data residency, SSRF/egress control,
  federation, BYOK/KMS, break-glass, DSAR (exceeds mainstream competitors).
- **AI governance** — kill switch, DLP redaction, per-role model allowlists, provenance.

The gaps are therefore concentrated in the **team-facing collaborative work-management
surface** and **agency/marketing** use cases — the half of the market that
Monday/Asana/ClickUp/Wrike own.

---

## Phase 1 — highest leverage, lowest cost (ride the existing architecture)

These three reuse the JSON-screen + panel registry + broker seam + workflow engine that
already exist, so they close the most competitive distance for the least build.

### 1.1 Intake / request forms  ✅ Done
- **Rationale.** End-user forms that capture a request → create work. The single clearest
  miss vs every competitor (a *DemandIntake report* is not a form).
- **Competitors.** Asana, Monday, Smartsheet, Wrike, Jira Service Management.
- **Acceptance.** (a) Admin/PMO can author a form (fields, types, required, target
  project) and store it in org config; (b) a `form` panel renders any form on a screen and
  validates client-side; (c) submit creates an issue through the broker with mapped fields
  + an intake marker (status/label), RBAC- and scope-guarded; (d) malformed defs/submits
  return typed 400s, never 500; (e) a routed **Intake** screen ships by default.
- **Architecture leverage.** New `form` panel kind; `forms` settings collection; a `form`
  methodology-composition kind; submission → `broker.writeIssue(create)` (same path as
  `POST /projects/:id/issues`).
- **Delivered.** Built exactly like screens/reports: shared **form template catalogue**
  (`@workspace/backend-catalogue` `FORMS`) → org-overridable `forms` config store →
  `form` composition kind (methodology-tagged) → generic `FormPanel` renderer → visual
  `FormsAdmin` builder (new / from-template / structured field + target editor) → routed
  `Intake` screen. Server: `lib/form-def.ts` (validation + submission→IssueWrite),
  `routes/forms.ts` (defs GET/PUT admin-PMO + scope-guarded `/forms/:id/submit`).
  Tests: shared catalogue (3), form-def (12), forms route (7), FormPanel (4), FormsAdmin (3).
- **Field primitives (have).** text, textarea, number, date, email, url, select (dropdown),
  radio, likert (defaults a 5-point scale), multiselect, checkbox, yesno, address (composite
  sub-fields) — all with server-side validation + serialisation to the mapped backend field. **Backlog (add as needed):** multi-select, radio,
  currency/money, user/assignee picker, project/entity picker, section/heading (layout),
  hidden/prefilled (e.g. requestedBy = current user), datetime/time, rating/scale, and
  conditional (show-if) logic. See "Form primitive backlog" below.
- **Input sanitisation & validation (in place).** Global 256 kb body limit +
  proto-pollution key stripping on all JSON; def validation blocks dangerous keys, whitelists
  field types, requires select options, and only maps to an issue-field allow-list;
  submission validation is whitelist-by-def (unknown submitted keys dropped), enforces
  required, coerces number/checkbox, checks select membership + email/url format, and caps
  every text field (own `maxLength`, else a 2 000-char default, hard ceiling 10 000);
  submit is `contributor`+ and project-scope-guarded, authoring is admin/PMO; the created
  issue now runs the **same business ruleset** as the interactive grid (read-only /
  require-description / … → 422). All writes flow through the broker sanitizer + audit.
- **Capability gating (vendor-advertised fields only).** A form may only map onto issue
  fields the connected backend ADVERTISES as storable (`FieldSupport.store`) — the same
  capability plane that gates the interactive grid's editable fields. Enforced at BOTH ends:
  authoring (PUT /forms rejects a map to an unsupported field, naming it) and submit
  (defensively drops any field the backend no longer advertises, in case capabilities
  changed since authoring). Core fields (projectId/title) are always kept.
- **Mandatory field mapping (nothing is homeless).** Every form field MUST declare a
  `mapTo` — the backend field its value writes to — so a value always has a place to live;
  there is no "dump everything into the description" fallback. Validation (server + admin
  builder) requires: a `mapTo` on each field, that it is a *writable* issue field, exactly
  one field mapped to `title`, and unique scalar targets (`description`/`labels` may
  aggregate several fields; everything else is one-field-each). If the backend can't store
  a field, or the builder doesn't map it, the field can't be used. The admin builder's
  "maps to" picker only offers capability-writable targets.

### 1.2 User-facing automation recipes  🚧 In progress
- **Slice 1 shipped (backend + builder):** shared `automation-catalogue` (trigger + action primitives, each
  action declaring its permission requirement); `lib/automation.ts` (validate, compile-to-workflow,
  requirement set — pure); `automations` settings collection; `routes/automations.ts` (RBAC authoring guard +
  `/preview` dry-run); `AutomationsAdmin` builder (trigger → conditions → actions + live preview). Recipes
  compile to the existing workflow engine — no new engine. Inform (notify) recipes run via the existing
  read+notify effect surface; **mutating recipes are gated to the autonomous-grant path** (the workflow runner
  refuses silent mutations). RBAC gate enforced: a viewer can author an inform recipe but not a work-item
  write.
- **Slice 2 shipped (execution):** `POST /automations/:id/run` — RBAC re-checked at run time, conditions
  evaluated against the trigger subject (`matchesConditions`, eq/ne/in/gt/lt/truthy), then the compiled
  action-only workflow runs through the caller-scoped effect surface. Inform recipes fire; mutating recipes
  return 202 (held for a grant). A "Test run" button in the builder. `compileRecipe` now compiles actions
  only (conditions are a runner-side pre-gate, the correct model for an external trigger subject).
- **Next slice:** live trigger binding (schedule → scheduled-job; event → the broker event/notify bus) so
  recipes fire automatically, and the grant-bound execution of mutating recipes.
- **Slice 4 — external executors + pub/sub triggers.** A recipe should be able to run **in-engine** (our
  workflow runner) OR be **dispatched to an external orchestrator** the deployment already runs — **Node-RED,
  Power Automate**, Make, n8n, Airflow — by compiling to that orchestrator's flow format. This reuses the
  existing broker **templates** (`src/broker/templates/*`) + `workflow-generator`, so "author once, run where
  you like". And an **MQTT-style subscription trigger**: OmniProject subscribes to a topic (the `mqtt`
  notification channel already in the catalogue) and recipes fire on messages — a pub/sub event model that
  also lets external flows publish back. Same RBAC gate + audit; the executor is just where the effects land.
  **Leverage.** broker templates, `workflow-generator`, the `mqtt` channel, notify/event bus.
- **Rationale.** A friendly "when X, do Y" builder. The powerful JSON **workflow engine +
  broker templates** already exist but are admin/developer-facing — this is the missing
  on-ramp.
- **Competitors.** Monday, Asana, ClickUp, Wrike, Smartsheet.
- **Acceptance.** (a) A trigger→condition→action recipe UI; (b) recipes compile to the
  existing workflow-engine JSON and run through the existing runner (no new engine);
  (c) a recipe library stored in org config; (d) dry-run/preview before enable; (e) runs
  are audited and honour existing RBAC/approval gates.
- **HARD CONSTRAINT — RBAC-gated authoring + execution.** A user may only automate what
  they are themselves permitted to edit. This is non-negotiable and must hold at BOTH ends:
  - **Authoring:** the recipe builder only offers actions/collections the author currently
    has edit rights to. An action the author can't perform by hand (e.g. editing RACI when
    the RACI collection edit-policy requires PMO, or writing a project outside their scope)
    is not selectable, and a saved recipe that references one is rejected server-side.
  - **Execution:** the recipe runs with the AUTHOR's effective permissions, scoped by the
    same `requireCollectionEdit` / project-scope / ruleset checks the interactive edit
    path uses — **never widened**. A later drop in the author's permissions (offboarding,
    role change) disables or re-scopes the recipe; it must not become a privilege-retention
    backdoor. Autonomous execution binds to an explicit grant (the existing
    autonomous-guard model), and privileged effects still pass approval chains.
  This mirrors the workflow engine's existing invariant ("effects are injected, RBAC-scoped
  by the caller, never widened") — the recipe UI must not become a way around it.
- **Architecture leverage.** `workflow.ts` interpreter + `workflow-run.ts` effects (already
  RBAC-scoped by caller); `requireCollectionEdit` / `collection-edit-policy` for the
  per-collection gate; `autonomous-guard` + `autonomous-grant` for scheduled/agent runs;
  scheduled-job/recurrence for time triggers; settings collection for recipe defs.

### 1.3 Project & portfolio template gallery  ✅ Done (slice 1)
- **Rationale.** "Spin up a project/portfolio from a template." Everyone has it; OmniProject
  has methodology presets + screen-def bundles but no end-user template gallery.
- **Competitors.** All of them.
- **Acceptance.** (a) Capture a project's screen defs + config bundle + seed work items as a
  named template; (b) browse a gallery and instantiate; (c) templates are shareable org
  config and can ship as bundles (new-methodology delivery vehicle); (d) instantiation is
  audited.
- **Architecture leverage.** `config-bundle`/`config-snapshot` plumbing; `screenDefs`
  merge; methodology composition presets.
- **Delivered (slice 1).** Built like forms: shared `template-catalogue` (shipped starters:
  scrum-starter, prince2-starter) → org-overridable `templates` config store → admin **gallery**
  (`TemplatesAdmin`: add-from-catalogue, curate, instantiate). Server: `lib/project-template.ts`
  (validation + pure instantiation plan), `routes/templates.ts` (defs GET/PUT admin-PMO +
  `POST /templates/:id/instantiate` — manager+, creates the project + seeds its work items through
  the broker, audited). New `:id` route classified in the route-scope ratchet.
  Tests: shared catalogue (2), lib (3), route (4), TemplatesAdmin (3). **Follow-up:** capture a
  LIVE project's screen-defs + config bundle into a template (currently authored/curated), and
  apply a template's methodology/composition on instantiate.

---

## Phase 2 — expected by specific segments

### Pre-build due diligence (per item: what we already have · what to reuse from others)

Before building any Phase 2 item we check two things — (1) what already exists in this codebase to
build **on**, and (2) proven, license-compatible code/design from **others** to adapt. Everything
must still obey the golden rules (JSON-def artifacts, built of **primitives**, **zero-at-rest** via
the broker seam, RBAC/capability gating, sanitisation, drift-guarded).

| Item | Have (build on) | Reuse/adapt from others |
| --- | --- | --- |
| **2.1 Docs/wiki** | Content-pages store + `settingsCollectionRouter`; `TextPanel` + `md.ts`; **presence-hub** (rooms) ; **comments/mentions** ; settings **version history** (`captureVersion`); primitive store | **TipTap** (MIT, ProseMirror) headless rich-text — schema = the primitive allow-list; **Yjs** (MIT) CRDT for co-edit (binds via `y-prosemirror`, `awareness`=cursors) over our SSE; store PM-JSON not HTML (no sink); DOMPurify only on paste. |
| **2.2 Guest/portal** | **magic-link** (`mintMagicToken`/`consume`, single-use), RBAC ladder, `Scope`/`resolveScope`, `guardProjectScope`, API-token programme scoping | Design: signed, scope-claimed, expiring token below `viewer` (GitLab project tokens / Metabase signed embeds / Notion share tiers). No new dependency. |
| **2.3 Whiteboard** | Panel registry (`PANEL_RENDERERS`/`PANEL_META`), presence live-cursors, broker `writeIssue` for sticky→item | **Excalidraw** (MIT) embeddable canvas, JSON scene model, PNG/SVG export → wrap as a `canvas` panel kind. (tldraw is better UX but non-MIT — check terms.) Pairs with X.1 native handoff. |
| **2.4 Proofing** | `TaskAttachment { url }` zero-at-rest refs; **approval-chain** engine + **passkey** sign-off; comments threads | **PDF.js** (Apache-2) to render; annotations as our own JSON overlay (pin x/y/page), not embedded in the PDF — deliverable stays a broker ref. Pin model per Wrike/Ziflow. |
| **2.5 Mobile/offline** | PWA shell SW (`sw.js`, never caches `/api/*`), `registerServiceWorker`, my-work/tasks read models, notifications SSE | **Workbox** (MIT) for read-cache + background-sync write queue; **Yjs + y-indexeddb** for offline edits; **web-push** (MIT) + VAPID for real push; Capacitor (MIT) shells as a stretch. |

**Highest-leverage single adopt: Yjs** — one dependency serves 2.1 (co-edit), 2.3 (cursors), 2.5
(offline). Introduce it once, behind our seam. Every visual surface (TipTap nodes, Excalidraw scene,
PDF overlay) enters as a **primitive** in the shared store, so it inherits capability-gating, admin
authoring, and the drift guards — no feature bypasses the golden rules.


### 2.1 Collaborative docs / wiki / knowledge base  ✅ Done (slices 1–7)
- **Competitors.** Notion, ClickUp, Confluence, Wrike. **Gap.** "Content pages" is a CMS
  library, not real-time rich-text co-editing / linked wiki.
- **Acceptance.** Rich-text documents with links/embeds, per-space organisation, presence
  on a doc, comments/mentions, version history; readable/editable under existing RBAC.
- **Leverage.** Presence hub + comments + content-pages storage; reuse SSE for co-presence.
- **Slice 1 ✅ (foundation).** Documents are **built of primitive blocks** (`DOC_BLOCK_TYPES` →
  the `block` primitive family in the shared store, drift-guarded): heading/paragraph/quote/
  callout/code, bullet/numbered/checklist, divider/table/embed. Bodies live in the backend
  through a new **broker seam** (`listWikiSpaces`/`listWikiDocs`/`getWikiDoc`/`writeWikiDoc`,
  optional + capability-gated → 501 when unsupported) — **zero-at-rest**. `/api/wiki/*` routes
  gated by existing RBAC (read viewer+, author contributor+, delete manager+). Every write
  passes one **sanitising choke point** (`sanitizeWikiDocWrite`): control-char stripping,
  length caps, per-type field allow-listing (smuggled fields dropped), safe-scheme-only embeds;
  bodies stored as block JSON (no HTML sink), rendered as escaped React text. `[[wiki-links]]`
  + server-resolved **backlinks**. Read-only `DocRenderer` + client hooks. Presence room
  `doc:<id>` and comments thread `doc:<id>` reuse the existing seams (no new realtime surface).
- **Slice 2 ✅ (authoring UI).** A `/wiki` page: spaces nav + doc list, read a document (rendered
  from its primitive blocks + server-resolved backlinks), and a **block-based `DocEditor`** whose
  insertable palette is drawn from the shared primitive store's `block` family (documents built of
  primitives). Create/edit/delete under the existing RBAC ladder (author contributor+, delete
  manager+); 501 → "unsupported" notice. Nav entry + route-coverage manifest + unit/e2e tests.
- **Slice 3 ✅ (live collaboration).** Presence avatars + a comments/@mentions thread on the doc view,
  keyed by the `doc:<id>` room. No backend change: `guardRoomScope` returns true for non-project rooms,
  so the existing comments/presence routes already serve doc rooms under the issue-comment RBAC (read
  any authed, write contributor+). `CommentsPanel` was generalised to a room-agnostic `roomId` prop.
- **Slice 4 ✅ (page tree).** Documents nest by `parentId` (already sanitised + stored server-side): a
  pure, cycle-safe `buildDocTree`/`flattenDocTree` renders the doc list as an indented tree, and the
  `DocEditor` gains a "parent page" picker that excludes the doc itself and its descendants (no cycles).
  A dangling/cyclic parent degrades to a root, so no page can be hidden or loop the walk.
- **Slice 5 ✅ (version history + diff).** The system of record captures a **revision snapshot on every
  write** (bounded ring); two optional capability-gated broker reads (`listWikiDocVersions`,
  `getWikiDocVersion` → 501 when a backend doesn't retain history) expose the history behind viewer+
  routes. The doc view gains a **History** panel: revisions newest-first, a pure structural
  **block diff** (`diffDocBlocks`, aligned by block id — no text-diff dependency, bodies stay block
  JSON) of "what changed since this revision", and a **Restore** that re-saves through the ordinary
  update path — same sanitiser + RBAC gate, and itself a new revision (no special restore power).
- **Slice 6 ✅ (real-time co-edit).** **Yjs** CRDT co-editing on the *existing block model* (not a
  ProseMirror swap — keeps the block primitives + sanitiser): `DocBlock[]` maps to a `Y.Array` of
  `Y.Map`s, block-granular merge. The server is a **dumb SSE relay** (`/api/collab/rooms/:roomId`,
  contributor+, room-scope-guarded) that never parses or stores the payload — the durable doc still
  saves through the broker seam (zero-at-rest); the CRDT stream is transient, like presence. A tiny
  join-sync handshake (state-vector exchange) uses only `yjs` core — no `y-prosemirror`/`y-protocols`.
  Deterministic seeding (fixed client id) means two people opening a page at once never duplicate its
  blocks. Behind the default-off `wikiCoEdit` flag; the editor degrades to plain local state when off.
- **Slice 7 ✅ (storage-target model — the canonical "user-held artifact" pattern, shared with whiteboards).**
  A page now saves to a **storage target the author chooses**: their **private** / a **project's** shared /
  the **org-wide** shared **encrypted-JSON** area (one AES-256-GCM sealed file per (type, scope) under
  `OMNI_CONFIG_DIR`, via the reusable `lib/artifact-store`) or the **sidecar** SoR. The scoped-id primitive
  (`makeScopedId`/`parseScopedId`/`scopeFromParsed`) and the per-target authz gate (`storage-target-authz`)
  are now **shared** with whiteboards — one implementation, no drift. Doc ids are **self-describing**
  (`<target>~…`) so a read routes with no lookup; a `user` scope always uses the caller's own sub (cross-user
  is structurally impossible). JSON docs keep **full feature parity**: a bounded **version ring** (retained in
  a sibling sealed collection, so history/diff/restore work), **backlinks** resolved across every accessible
  store, and space grouping (broker spaces ∪ a `General` fallback ∪ synthesised spaces from JSON docs, so a
  JSON-only deployment is fully usable). `GET /wiki/docs` aggregates across accessible stores. Per-target RBAC
  (org write/delete = manager+, project = `guardProjectScope`); the page's create control picks Personal /
  Org-wide / Built-in store. The wiki no longer depends on a broker at all.
- **2.1 complete.** Wiki now has documents-of-primitives, authoring, presence+comments, a page tree,
  version history + diff, real-time co-edit, and author-chosen encrypted-JSON storage targets — zero-at-rest.

### 2.2 Guest / external collaboration & client portals  ✅ Done (slices 1–2; comment tier deferred)
- **Competitors.** Monday, Wrike, Smartsheet. **Gap.** Enterprise-IdP/SCIM only; no
  limited-seat guest access (blocks agencies/consultancies).
- **Acceptance.** Scoped guest principals (single project/board), magic-link or restricted
  IdP, read-or-comment tiers, no portfolio/admin surface, fully audited; a client-facing
  status portal view.
- **Leverage.** magic-link auth, RBAC ladder, scope guards, screen visibility gating.
- **Slice 1 ✅ (scoped guest principal + portal backend).** A new **`guest` role FLOOR** (below viewer,
  in both server + client ladders) that fails every `requireRole("viewer")` gate — so a guest is locked
  out of the whole app by a single hard viewer-floor gate and can reach ONLY the portal. A new **`project`
  scope level** confines a guest to exactly one project id (enforced at the gateway `assertProjectScope`
  AND re-enforced at the broker data seam). Guests are issued via a **sealed, single-use magic-link invite**
  (`mintGuestToken`, scope claims inside the token) — governed by `GUEST_PORTAL_ENABLED`, so it works
  alongside a configured IdP (unlike plain magic-link). `POST /api/portal/invites` (manager+, project-scoped)
  and `GET /api/portal/status` (guest+, its one project) — the status is an explicit **allow-list** of
  client-safe fields (name, progress, RAG rollup, dated milestones); never budget/cost/benefit. Every guest
  action is audited automatically. Security tests: guest 403 on all app routes, single-use, invite RBAC,
  no financial leakage, portal-off ⇒ 404.
- **Slice 2 ✅ (portal UI + invite).** A bare **`/portal`** route (no AppLayout chrome, like `/explore`)
  rendering the guest's curated status (progress bar, RAG rollup, dated milestones) read-only; a **guest
  redirect** in AppLayout bounces any guest to `/portal` (and returns null to avoid a shell flash), so a
  guest only ever sees the portal. A manager **invite panel** in Settings (`GuestInvitePanel`, manager+)
  posts a scoped invite. Client hooks (`usePortalStatus`/`useInviteGuest`), e2e route-manifest + smoke,
  unit tests. The **comment tier** (a guest leaving comments on its project) is deferred to a later slice.

### 2.3 Whiteboards / visual canvas  🚧 In progress (slices 1–2)
- **Competitors.** Miro/Mural, ClickUp, Monday. **Gap.** No infinite canvas.
- **Acceptance.** Freeform canvas (sticky notes, shapes, connectors, freehand), multi-user
  live cursors, convert a sticky → work item; export.
- **Leverage.** Presence/live-events; new `canvas` panel kind; drill-to for item creation.
- **Pairs with:** X.1 Native handoff — our inline whiteboard is the "good enough" version; the
  "Use native" button hands off to Miro/Lucid/Figma when connected.
- **Slice 1 ✅ (canvas primitive family + broker seam + sanitiser + hooks).** Dependency-free foundation,
  mirroring the wiki — and, per the "built of primitives" rule, the whiteboard is our OWN model, not an
  opaque third-party scene. A new **`canvas` primitive family** (`CANVAS_ELEMENT_TYPES` in
  backend-catalogue → the shared primitive store, drift-guarded): **sticky / shape / text / connector /
  frame**. A scene is a list of these typed primitives. Optional capability-gated broker methods
  (`listWhiteboards`/`getWhiteboard`/`writeWhiteboard` → 501 when unsupported), a demo impl, RBAC-gated
  `/api/whiteboards/*` routes (read viewer+, author contributor+, delete manager+) behind the default-off
  `whiteboard` feature module. Stored as neutral JSON through the seam (**zero-at-rest**) via one
  **sanitising choke point** (`sanitizeWhiteboardWrite`): count + total-size caps, **per-type field
  allow-listing** (a smuggled field/inline image/script link can't ride along), coordinate clamping, safe-
  scheme links only, unknown-type elements dropped. Drift guards updated (autonomous-guard classifier +
  read allow-list, route-scope classification, primitive-store family binding). Client hooks. Tests.
- **Slice 2 ✅ (native SVG canvas editor).** A `/whiteboards` page + a **native SVG editor built of the
  `canvas` primitives** — reimplementing the standard pointer-driven interaction model (pick a tool →
  pointer-down creates/selects, move drags/draws, up commits) in our own code, using the same MIT libs
  Excalidraw is built on: **roughjs** for the hand-drawn shape look (deterministic per element id) and
  **perfect-freehand** for pen strokes. Tools: select/move, sticky (+colour), shape (+kind), text,
  connector, pen, frame; an inspector edits/deletes the selected element. Added a `draw` primitive for
  freehand. Saves through the seam (contributor+); nav entry (feature-gated), route + e2e manifest + smoke.
  The canvas libs are a 31 kB lazy chunk (vs. ~1 MB for Excalidraw). Pure geometry/reducers + editor +
  page tests.
- **Slice 3a ✅ (sidecar SoR persistence + org/personal ownership).** The **built-in broker** (our
  self-hosted system of record) now implements the whiteboard capability, so boards genuinely persist on
  a standalone deployment — not just the demo. Scenes are stored in the **OmniStore**'s encrypted,
  hash-chained, append-only event log (durable + tamper-evident at rest; proven by a seal→reopen test).
  A board is **org-wide (shared) or personal (owner-only)**: the owner is stamped server-side from the
  caller (never the client), and a shared pure rule (`whiteboard-ownership`) enforces visibility/edit/
  delete across BOTH the demo and built-in brokers — a personal board is `not_found` to a non-owner (no
  leak). Capability-gated on the store: a store that can't persist (the SQL sidecar) leaves the methods
  undefined → routes 501. This is the correct reading of **zero-at-rest**: the sidecar IS the system of
  record; the stateless overlay still stores nothing.
- **Slice 3b ✅ (storage-target model — the canonical "user-held artifact" pattern).** A board is now saved
  to a **storage target the author chooses**, not the broker by default: their **private** encrypted-JSON
  area, a **project's shared** area, the **org-wide shared** area, or the **sidecar** SoR (when loaded). The
  three JSON areas are one **AES-256-GCM sealed** file per (type, scope) under `OMNI_CONFIG_DIR` — a new
  reusable `lib/artifact-store` (`listArtifacts`/`getArtifact`/`putArtifact`/`deleteArtifact` over `user` /
  `project` / `org` scopes), so **zero-at-rest holds honestly** (nothing plaintext on disk; disabled when no
  config dir). Board ids are **self-describing** (`<target>~…~<localId>`) so a later read/write routes to the
  right store with no lookup; a `user` scope **always** uses the caller's own sub, so one user's id can never
  address another's area (structurally isolated — proven by an isolation test). Per-target RBAC: read viewer+,
  author contributor+, delete contributor+, with an **org write/delete additionally requiring manager+**;
  project targets are `guardProjectScope`-gated. `GET /whiteboards` **aggregates** metadata across every
  accessible store. The page's create control now picks Personal / Org-wide / Built-in store. **This is the
  pattern to roll across the board (wiki pages next).**
- **Slice 3c ✅ (export — SVG + PNG).** A board exports to a **portable file, entirely client-side** (nothing
  uploaded, so no residency concern): a **standalone SVG** (vector, cropped to the scene bounds with an opaque
  white background) or a **rasterised PNG** (2× via an offscreen canvas). Built by cloning the live `<svg>`,
  so the export captures exactly what's on screen — roughjs hand-drawn paths and perfect-freehand strokes and
  all — rather than re-deriving the drawing. The scene-bounds maths is pure + unit-tested; the editor exposes
  its `<svg>` through a small imperative ref so the page's Export controls reach it without owning editor
  state. Export is offered to **anyone who can see the board (incl. viewers)**.
- **Slice 3d ✅ (sticky → work item).** A selected sticky offers a **"Create work item"** action that mints a
  real issue from its text through the existing broker seam (`createIssue`) into a **chosen project** (a
  header picker, defaulting to the board's own project for a project-stored board, else the first visible
  project). On success the sticky is **linked back** to that project's board (an absolute URL, so the
  write-side sanitiser keeps it — save the board to persist the link). contributor+ (issue authoring); the
  editor stays dumb (it just calls back), the page owns project selection + creation. **Slice 3 (remaining):**
  multi-user live cursors.

### 2.4 Proofing / deliverable review & annotation  ⬜ Todo
- **Competitors.** Adobe Workfront, Wrike, Smartsheet. **Gap.** No creative review markup.
- **Acceptance.** Attach a deliverable (image/PDF), pin annotations, threaded review,
  approve/reject decision bound to a version; ties into approval chains.
- **Leverage.** Approval-chain + passkey sign-off; comments; attachments as references.

### 2.5 Native mobile + offline  ⬜ Todo
- **Competitors.** All. **Gap.** PWA caches app-shell only; no offline data, no native apps.
- **Acceptance.** Offline-capable data cache for my-work/tasks with sync-on-reconnect;
  installable; push notifications; (stretch) native shells.
- **Leverage.** Existing PWA service worker; my-work/tasks read models; notifications SSE.

---

## Phase 3 — deepen what exists only partially

### 3.1 Full interactive scheduling engine  ⬜ Todo
- **Competitors.** MS Project, Smartsheet, Planview. **Have.** Gantt + CPM + baselines +
  Monte-Carlo. **Missing.** Auto-scheduling: working calendars, task constraints
  (SNET/FNLT), lead/lag, drag-a-bar-and-cascade-dependencies.
- **Leverage.** `critical-path.ts`, GanttChart, dependencies lib, baseline.

### 3.2 Goals / OKRs as a managed cadence  ⬜ Todo
- **Competitors.** Asana Goals, Viva Goals, ClickUp. **Have.** Strategy cascade + PI board
  as *reports*. **Missing.** First-class goal objects with check-ins, progress updates,
  goal↔work linking on a cadence.
- **Leverage.** strategy-cascade lib, reminder-sweep/recurrence for check-in cadence.

### 3.3 Live time tracking + invoicing  ⬜ Todo
- **Competitors.** Harvest/Toggl, Workfront. **Have.** Timesheets (submit/approve) +
  income/invoicing reports. **Missing.** Start/stop timers, invoice generation.
- **Leverage.** timesheet lib, income/invoicing reports, financials.

### 3.4 Third-party app / plugin marketplace  ⬜ Todo
- **Competitors.** Jira/Monday/Asana marketplaces. **Have.** 41 connectors + MCP + broker
  seam. **Missing.** UI-extension ecosystem (installable panels/screens/reports).
- **Leverage.** Panel registry, screen-def bundles, MCP, config-bundle delivery.

---

## Cross-cutting

### X.1 Native handoff (companion-app bridge)  ⬜ Todo — full design in `docs/NATIVE-HANDOFF.md`
- **Rationale.** Our inline artifacts (whiteboard, doc, sheet, board, gantt, dashboard) are "good
  enough"; a **"Use native"** button hands off to the specialist SaaS a connected backend already
  fronts (Miro, Notion, Smartsheet, MS Project, Power BI, …). The user works there under their own
  login and the artifact comes back **through the broker** as a reference. Purest expression of the
  thesis: *your tools stay the source of truth; nothing syncs, nothing migrates.*
- **Generalised — every SaaS backend, every artifact kind**, not whiteboard-specific. A connector
  advertises the native surfaces it fronts; the SPA lights up "Use native (\<vendor\>)" on any
  artifact whose `kind` a connected backend advertises.
- **Contract.** A `NativeSurface` descriptor in the connector catalogue + three optional broker
  methods: `nativeSurfaces` (advertise, capability-unioned), `nativeHandoff` (mint the vetted,
  host-allowlisted vendor URL), `nativeImport` (bring it back through the broker as a
  `TaskAttachment { url }`). One reusable capability-gated `<UseNative>` control — no per-vendor UI.
- **Why it's safe.** Broker-mediated ⇒ inherits every data-seam control for free: `safeFetch`
  (SSRF/egress), residency 451 fail-closed, vault credentials (user's own OAuth token, scope never
  widened), sanitiser, provenance, audit. Connector-minted URLs (never user input), login stays in
  the user's real browser (we never wrap the vendor's auth screen), reference-only by default
  (zero-at-rest). **A new connector capability, not a new security boundary.**
- **Leverage.** Broker seam + connector catalogue + capability resolver + attachments +
  vault/`storeCredential` + egress/residency + provenance/audit + the primitive store (`kind`).
- **Slices.** (1) reference handoff + `<UseNative>` button; (2) sandboxed Live-Embed preview;
  (3) OAuth + content import (metadata/thumbnail via `safeFetch`).

---

## Primitives as objects / methods / classes

The mental model: each entry in the store is a **class** — its config are properties (a field's
`options`, `maxLength`; a panel's `source`), it produces a typed **value**, and it carries
**methods** (validate, render, serialise-to-backend). An instance placed on a screen or form is
an **object**; the family-specific renderer map is where a class's `render` method lives, and
`form-def.ts` holds the field classes' `validate`/`serialise` methods. The unified store is the
class registry; the drift guard keeps it honest. Adding a primitive = defining a new class
(catalogue entry + renderer/validator) — it then shows up everywhere, and JSON defs instantiate
it as objects.

## Single shared primitive store

`artifacts/omniproject/src/lib/primitive-store.ts` is THE one catalogue over every renderable
building block, so screens, reports, dashboards, content pages and forms draw from one source
of truth rather than a registry each. Four families under one `Primitive` shape + one
`placeableIn` vocabulary:

- `panel` — screen building blocks (from the panel renderer registry)
- `viz` — data-visualisation primitives (from the chart primitive library; shared by chart
  panels *and* reports)
- `field` — form input controls (from the shared `FORM_FIELD_TYPES`)
- `component` — hosted reports + dashboard widgets (from the shared component library)

Each primitive carries a **`category` subfolder** (the palette groups as `family / category`) and
**`tags`** (orthogonal, cross-cutting labels for filtering — "timeseries", "editable", "financial",
…). Helpers: `primitiveTree(surface?)` (family → category subfolders → primitives, optionally scoped
to a placement surface), `categoriesFor(family)`, `allTags()`, `primitivesByTag(tag)`,
`primitivesFor(surface)`.

It doesn't rip out the family-specific renderer maps (a renderer is a React component and must
live in the app); it unifies their metadata and a **drift guard** (`primitive-store.test.ts`)
binds each family back to its registry, so the store can never silently diverge from what
actually renders.

**Why it's derived, not hand-listed — extensibility.** The store is *computed* from the
registries, so a new primitive ships as a normal update: add its catalogue entry + renderer (or,
for viz, a drop-in primitive JSON — `PRIMITIVE_LIBRARY` already merges those) and it appears in
the store automatically; the drift guard guarantees coverage; every authoring surface picks it up
with no per-surface edit; and any new JSON **def files** (screens / forms / reports) that
reference it render through the existing generic renderers. So "a new primitive + the JSON defs
that use it" is one shippable bundle.

**Authoring surfaces wired (done — one palette everywhere):**
- `ScreenEditor` panel-kind picker → `familyFolders("panel","screen")` (subfolder optgroups); fixed a
  stale hand-maintained list that had drifted (omitted register/form/…).
- `FormsAdmin` field-type picker → `familyFolders("field","form")` (subfolder optgroups).
- `PrimitiveLibrary` (the browsable palette, also embedded in the **report builder**
  `CustomReportsAdmin`) → renders the whole store via `primitiveTree(surface?)`: every family, grouped
  into category subfolders, with tag chips; viz primitives keep their chart-catalogue detail; `surface`
  scopes it; `onPick` returns the store `Primitive`.
- `Dashboards` add-widget picker → the store's `component` family placeable on a dashboard
  (`primitivesFor("dashboard")`), intersected with the capability-available widgets, value = `sourceId`.

Every insertion/browse surface now reads from the one store, so a new primitive shipped as an update
appears in all of them with no per-surface edit.

## Form primitive backlog

Ordered by value for a PPM/intake context. Each is a new `FormFieldType` in the shared
catalogue + a branch in `validateSubmission` (server) and `FormPanel`/`FormsAdmin` (client).

1. **user / assignee picker** → maps to `assignee`; pick a real member, not a free string.
2. **multi-select** → maps to `labels` (array); checkboxes or a multi-select control.
3. **radio** → single choice with visible options (select UX variant).
4. **currency / money** → maps to `budget` (+ currency); numeric with a currency code.
5. **project / entity picker** → choose the target/related project at submit time.
6. **section / heading** → layout-only, non-input; groups long forms.
7. **hidden / prefilled** → e.g. `requestedBy` = current user, `source` = "intake form"
   (server-stamped, never trusted from the client).
8. **datetime / time** → finer than `date` for scheduling intake.
9. **rating / scale** → 1–5 impact/severity capture.
10. **conditional (show-if)** → show a field only when another has a given value (logic, not
    just a primitive) — the largest lift; do last.

File attachments are intentionally **not** a primitive: the platform stores no files at rest,
so an attachment field would be a URL reference (`url` type) pointing at the system of record.

## Status legend

- ⬜ **Todo** — not started.
- 🚧 **In progress** — actively being built.
- ✅ **Done** — shipped; record the commit/PR.

## Changelog

- _2026-07-16_ — Roadmap created from competitive gap analysis. Phase 1.1 (Intake forms)
  started.
- _2026-07-16_ — Phase 1.1 (Intake forms) shipped, built on the screen/report pipeline
  (shared template catalogue → org-override store → composition kind → generic panel →
  visual admin builder → routed screen).
- _2026-07-16_ — Forms hardening: added email/url primitives + per-field length caps
  (default 2 000, ceiling 10 000), and routed form-created issues through the same business
  ruleset as the grid. Documented the form primitive backlog and, for 1.2, the hard
  RBAC-gating constraint (automate only what you may edit).
- _2026-07-16_ — Forms capability gating: a form can only map onto issue fields the
  connected backend advertises as storable, enforced at authoring and submit.
- _2026-07-16_ — Phase 1.2 slice 1 (automation recipes) shipped; single shared primitive store
  (subfolders + tags + drift guard) with every authoring surface wired to it; richer form field
  primitives (radio/likert/multiselect/yesno/address). Branch merged to `main` (PR #661).
- _2026-07-16_ — Added cross-cutting **X.1 Native handoff** design (`docs/NATIVE-HANDOFF.md`):
  a generalised "Use native" companion-app bridge — broker-mediated, so it inherits every
  data-seam control. Generalised across all SaaS backends + artifact kinds.
- _2026-07-16_ — Phase 1.3 refinement: **templates stored as default JSON + org override** —
  both apps resolve the shipped catalogue ∪ the org's overrides (org wins by id) via
  `resolveProjectTemplates`, so a shipped starter is instantiable directly and an org can
  customise or revert it. Gallery shows the effective set with per-row Customise/Revert.
- _2026-07-16_ — Phase 2 **pre-build due-diligence** recorded (per item: existing code to build
  on + proven external code/design to adapt). Yjs flagged as the highest-leverage single adopt
  (co-edit + cursors + offline). Building Phase 2 in order, starting 2.1.
- _2026-07-16_ — Phase 2.1 slice 1 (collaborative docs/wiki foundation) shipped: documents built
  of `block` primitives (new drift-guarded family), a zero-at-rest broker wiki seam, RBAC-gated
  `/api/wiki/*` routes behind one sanitising choke point (per-type allow-listing, safe-scheme
  embeds, no HTML sink), `[[wiki-link]]` backlinks, read-only `DocRenderer` + client hooks.
  Presence/comments reuse the existing `doc:<id>` room seams. Yjs co-edit + authoring UI next.
- _2026-07-16_ — Phase 2.1 slice 2 (authoring UI) shipped: a `/wiki` page — spaces nav + doc list,
  a read view (blocks + backlinks), and a block-based `DocEditor` whose palette is the primitive
  store's `block` family. Create/edit/delete under the RBAC ladder; 501 → unsupported notice.
- _2026-07-16_ — Phase 2.1 slice 3 (live collaboration) shipped: presence avatars + comments/@mentions
  on the doc view via the `doc:<id>` room, reusing the existing seams with no backend change
  (`guardRoomScope` already allows non-project rooms). `CommentsPanel` generalised to a `roomId` prop.
- _2026-07-16_ — Phase 2.1 slice 4 (page tree) shipped: docs nest by `parentId` with a pure,
  cycle-safe `buildDocTree`; the sidebar renders an indented tree and the editor offers a descendant-
  excluding parent picker. Dangling/cyclic parents degrade to roots (no page hidden or lost).
- _2026-07-16_ — Phase 2.1 slice 5 (version history + diff) shipped: the SoR captures a revision
  snapshot per write (bounded ring); two optional broker reads (`listWikiDocVersions`/`getWikiDocVersion`,
  501 when unsupported) feed a viewer+ History panel with a pure structural block diff (`diffDocBlocks`)
  and a Restore that re-saves via the normal update path (same sanitiser + RBAC, itself a new revision).
- _2026-07-16_ — Phase 2.1 slice 6 (real-time co-edit) shipped, **completing 2.1**: Yjs CRDT on the
  existing block model (`DocBlock[]` ↔ `Y.Array`/`Y.Map`, block-granular merge, deterministic idempotent
  seeding), a dumb contributor+ SSE relay (`/api/collab/rooms/:roomId`, room-scope-guarded, never stores
  the opaque payload — durable doc still saves through the broker seam), a state-vector join-sync using
  only `yjs` core (no y-prosemirror), behind the default-off `wikiCoEdit` flag. New dep: `yjs` (client).
- _2026-07-16_ — Phase 2.2 slice 1 (scoped guest principal + portal backend) shipped: a `guest` role floor
  (server + client) that fails every viewer+ gate (one hard viewer-floor gate locks guests to the portal),
  a `project` scope level confining a guest to one project (gateway + broker-seam enforced), sealed
  single-use magic-link invites (`GUEST_PORTAL_ENABLED`, works alongside an IdP), and `POST /portal/invites`
  (manager+) / `GET /portal/status` (guest+, allow-listed client-safe fields — no financials). Guest actions
  auto-audited. Portal UI + redirect + comment tier are slice 2.
- _2026-07-16_ — Phase 2.2 slice 2 (portal UI + invite) shipped, **completing 2.2** (comment tier deferred):
  a bare `/portal` status page, an AppLayout guest redirect (a guest only ever sees the portal), a manager
  `GuestInvitePanel` in Settings, client hooks, e2e manifest + smoke, unit tests.
- _2026-07-16_ — Phase 2.3 slice 3b (whiteboard storage-target model) shipped: a board saves to a target the
  author picks — their private / a project's / the org-wide **encrypted-JSON** area (one AES-256-GCM sealed
  file per (type, scope) under `OMNI_CONFIG_DIR`, via a new reusable `lib/artifact-store`) or the **sidecar**
  SoR. Ids are **self-describing** (`<target>~…~<localId>`) so reads route with no lookup; a `user` scope
  always uses the caller's own sub (cross-user is structurally impossible). Per-target RBAC (org write/delete
  = manager+, project = `guardProjectScope`); `GET /whiteboards` aggregates across accessible stores. **The
  canonical pattern for user-held artifacts — wiki pages adopt it next.**
- _2026-07-16_ — Phase 2.1 slice 7 (wiki storage-target model) shipped, rolling the whiteboard pattern
  "across the board": a wiki page saves to the author's private / a project's / the org-wide **encrypted-JSON**
  area or the **sidecar**. The scoped-id primitive (`makeScopedId`/`parseScopedId`/`scopeFromParsed`) and the
  per-target authz gate (`storage-target-authz`) are now **shared** with whiteboards (one implementation, no
  drift). JSON docs keep full parity — a bounded **version ring** (sealed sibling collection → history/diff/
  restore still work), **backlinks** across every accessible store, and space grouping (broker ∪ `General`
  fallback ∪ synthesised). Self-describing ids, `user` scope always the caller's own sub, per-target RBAC. The
  wiki no longer needs a broker at all.
- _2026-07-16_ — Phase 2.3 slice 3c (whiteboard export) shipped: a board exports to a **standalone SVG**
  (vector, cropped to the scene with a white background) or a **rasterised PNG** (2×), entirely client-side —
  nothing uploaded. Built by cloning the live `<svg>` so the export matches the screen exactly (roughjs +
  freehand included); pure scene-bounds maths (`lib/whiteboard-export`, unit-tested); the editor exposes its
  `<svg>` via an imperative ref. Offered to anyone who can see the board (incl. viewers).
- _2026-07-16_ — Phase 2.3 slice 3d (sticky → work item) shipped: a selected sticky mints a real issue from
  its text through the broker seam (`createIssue`) into a chosen project (header picker, defaulting to the
  board's own project), then links the sticky back to that project's board (absolute URL → survives the
  sanitiser). contributor+; the editor calls back, the page owns project selection. Only live cursors remain
  for 2.3.
