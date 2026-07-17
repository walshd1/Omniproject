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

### 2.3 Whiteboards / visual canvas  ✅ Done (slices 1–3)
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
  editor stays dumb (it just calls back), the page owns project selection + creation.
- **Slice 3e ✅ (multi-user live cursors), completing 2.3.** Cursor presence on a board over the SAME generic
  in-memory relay the wiki co-edit uses (`lib/collab-hub`) but on a distinct `board:<id>` room space — added
  to the **whiteboard** feature module itself (a `GET …/rooms/:roomId/stream` SSE + a `POST …/rooms/:roomId`
  broadcast), so cursors ship with whiteboards and stay decoupled from the wiki flag. Purely transient like
  presence — **nothing is stored**; the durable scene still saves through the storage target. Each tab
  broadcasts its pointer position (throttled ~60ms); peers' cursors render as labelled pointers with a
  per-user colour and a short TTL so a silent leave fades. **Identity (label + colour) is stamped
  server-side** from the session, so a peer can't spoof another's name; only the position is client-supplied.
  A project board's cursor room is `guardProjectScope`-checked (IDOR), classified + probed by the route-scope
  ratchet. viewer+ (seeing/sharing a cursor isn't authoring); gated on the existing **presence** governance
  toggle, and degrades to a no-op where `EventSource` is unavailable. Reuses the shared `peerColor`.
- **2.3 complete.** Whiteboards now have a native primitive-built canvas, storage targets, SVG/PNG export,
  sticky → work item, and multi-user live cursors — the inline "good enough" canvas the roadmap called for.

### 2.4 Proofing / deliverable review & annotation  ✅ Done (slices 1–4)
- **Competitors.** Adobe Workfront, Wrike, Smartsheet. **Gap.** No creative review markup.
- **Acceptance.** Attach a deliverable (image/PDF), pin annotations, threaded review,
  approve/reject decision bound to a version; ties into approval chains.
- **Leverage.** Approval-chain + passkey sign-off; comments; attachments as references.
- **Slice 1 ✅ (foundation — proof model + storage-target routes + hooks).** A proof is a **JSON definition**
  built of primitives, mirroring wiki/whiteboard: a new **`annotation` primitive family** (`ANNOTATION_TYPES`
  in backend-catalogue → the shared primitive store, drift-guarded): **pin / box / highlight**, placed on the
  new `proof` surface. A proof **references** a deliverable (image/PDF) rather than inlining it
  (attachments-as-references, **zero-at-rest**) and carries the annotations + a review **decision bound to a
  version**. Saved to a **storage target** the author picks — their private / a project's / the org-wide
  **encrypted-JSON** area (AES-256-GCM sealed), reusing the shared scoped-id + `authorizeStorageTarget`
  primitives (no sidecar — a proof is always OmniProject-held overlay metadata). Behind a default-off
  `proofing` feature module: `/api/proofs/*` CRUD (read viewer+, author contributor+, org writes manager+) +
  `POST /proofs/:id/decision` (approve/reject/changes-requested, **stamped server-side**, bound to the
  version; replacing the deliverable bumps the version and **re-opens** the decision). One **sanitising choke
  point** (`sanitizeProofWrite`): safe-scheme-only deliverable url, coordinates clamped to normalised 0..1,
  per-type annotation field allow-listing, size caps. Client hooks. Drift guard + catalogue + sanitiser +
  route (sealed-at-rest, user isolation, org gating, decision/version) tests.
- **Slice 2 ✅ (annotation UI).** A `/proofs` page + an **`AnnotationOverlay`** that renders the deliverable
  (image inline, PDF via `<object>` with a link fallback) and overlays the `annotation` primitives
  (pin/box/highlight) at **normalised coordinates** (they survive any render scale). Tools: select / pin /
  box / highlight — click to place, drag to move, an inspector edits the note + a resolved toggle + delete.
  The page browses proofs (with a per-proof decision badge), a create form (name + deliverable url + kind +
  storage target), Save, Delete, and a **review decision bar** (Approve / Request changes / Reject → the
  server-stamped, version-bound decision route). Authoring is contributor+ (a viewer sees the markers,
  read-only); an org proof's write/delete/decision needs manager+. Nav entry (feature-gated on `proofing`) +
  route + e2e manifest + i18n. Pure geometry (`lib/proof-geometry`) + overlay + page tests.
- **Slice 3 ✅ (threaded review).** A **comment thread per annotation**, reusing the existing comments seam
  with **no backend change** — the overlay lifts its selection (`onSelect`), and the page renders a
  `CommentsPanel` keyed by the `proof:<id>#<annotationId>` room (an unselected proof shows its general-
  discussion thread, `proof:<id>`). Same room-scope treatment as wiki doc comments (org-content; a caller
  needs the proof id, and the proof read is already access-controlled). Gated on the existing `comments`
  module; read for any authed user, post contributor+ (the seam's own RBAC). Overlay `onSelect` +
  general/per-annotation thread switch tests.
- **Slice 4 ✅ (approval-chain + passkey binding), completing 2.4.** The approve/reject decision is now a
  first-class, **auditable + non-repudiable** governance act, not a soft field. When an admin binds
  `proof.decision` to an approval chain (settings `approvalBindings`), `POST /proofs/:id/decision` **holds**
  the decision (202) and raises a proposal via the shared `proposeIfBound` gate — the exact workflow-run
  pattern (`lib/proof-approval.ts`: a single `proof.decision` action + an executor that stamps the held
  decision when the chain reaches `approved`). The decision is only applied after a **different** approver
  (separation of duties, enforced by the engine) signs it off with a **passkey** over the proposal's content
  hash (`{ proofId, decision, version, scope }`), reusing the whole challenge/verify machinery unchanged. The
  version is snapshotted at propose time, so a **stale sign-off can never land on newer artwork** (a new
  deliverable re-opens the review → the executor NO-OPs). Unbound (default) ⇒ applied directly, as before.
  Client shows a "sent for sign-off" state on a held decision. Executor unit tests (apply / stale-version
  no-op / deleted-proof no-op) + a full end-to-end route test (bind → hold 202 → enrol → challenge → signed
  approve → applied, attributed to the reviewer, version-bound) + an SoD-refusal test.
- **2.4 complete.** Proofing now has the annotation data model, the overlay UI, threaded review, and a
  passkey-signed, chain-gated review decision — the creative-review markup competitors have, on OmniProject's
  own governance rails.

### 2.5 Native mobile + offline  🚧 In progress (slices 1–3)
- **Competitors.** All. **Gap.** PWA caches app-shell only; no offline data, no native apps.
- **Acceptance.** Offline-capable data cache for my-work/tasks with sync-on-reconnect;
  installable; push notifications; (stretch) native shells.
- **Leverage.** Existing PWA service worker; my-work/tasks read models; notifications SSE.
- **Already in place (pre-2.5).** Installable app-shell PWA: `public/manifest.webmanifest` (standalone, SVG
  any+maskable icons, theme/bg, `display_override`) linked in `index.html` (+ apple-touch-icon, theme-color,
  `viewport-fit=cover`); `public/sw.js` (network-first navigations, stale-while-revalidate hashed assets) +
  `lib/pwa.ts` prod-only registration — **app-shell ONLY, never `/api`/`/auth`/non-GET**, so zero-at-rest
  holds; `lib/platform.ts` capability detection (serviceWorker/standalone/touch/webShare/`nativeBridge` hook).
- **Zero-at-rest decision for offline data:** the offline read cache will be **encrypted + ephemeral +
  opt-in** — my-work/tasks read models only, AES-GCM'd with a session-scoped non-extractable WebCrypto key,
  TTL'd, wiped on logout; off by default behind a per-user toggle. (Slice 2.)
- **Slice 1 ✅ (true offline detection + install-prompt UX).** `lib/connectivity` — a `useOnline` hook
  (`navigator.onLine` + online/offline events) and a pure `connectivityState(online, healthy)` that
  distinguishes **offline** (no network) from **unreachable** (network up, gateway down) from **connected**;
  the header indicator now reflects all three (device-offline dominates), amber for unreachable. `lib/
  use-install-prompt` captures `beforeinstallprompt`, suppresses the native infobar, and surfaces our own
  **Install** button (replayable once; clears on `appinstalled`; stays hidden on iOS/Safari, which has no
  such event). i18n `header.install` (4 locales). Client-only, **no zero-at-rest impact**. Pure + hook tests.
- **Slice 2 ✅ (encrypted, ephemeral, opt-in offline data cache).** `lib/offline-cache` — the on-device store
  for the **my-work/tasks read models only** (`isCacheableKey` allow-list): every entry is **AES-256-GCM**
  ciphertext (random IV) under a **non-extractable** WebCrypto key held in IndexedDB (raw bytes never
  readable by script). The key is **session-scoped** — bound to the signed-in `sub`, so opening as a
  different user **wipes + re-mints** (no cross-user read on a shared device). Entries **TTL** (24h) and the
  whole store is **wiped on logout** (`lib/auth`) and when the toggle flips off. `lib/use-offline-cache` — a
  per-user, off-by-default toggle (gated by a new default-off `offlineCache` feature module) + a
  hydrate-on-open (seed the query cache where empty, so my-work/tasks render offline) + a subscriber that
  writes allow-listed results back. An **Offline access** card in Performance settings with the
  encrypted-ephemeral explainer. **Zero-at-rest preserved**: nothing plaintext at rest, narrow scope, nothing
  survives the session. Crypto round-trip / wrong-key / tampered-GCM / allow-list / TTL / guarded-no-op tests;
  toggle + settings-card tests. **Next:** push notifications (slice 3).
- **Slice 3 ✅ (browser Web Push notifications).** An extra delivery channel on top of the existing in-app
  SSE + external channels, reaching a device even when the PWA is closed — via the MIT **`web-push`** dep
  (VAPID RFC 8292 + payload encryption RFC 8291). Server: `lib/web-push` (VAPID config gate — **inert unless
  `VAPID_PUBLIC_KEY`/`PRIVATE_KEY` are set** — plus an **egress allow-list**: a subscription `endpoint` is
  only POSTed to when its host is a known push service (FCM/Mozilla/Windows/Apple), bounding SSRF);
  `lib/push-subscriptions` stores each device's subscription **per-user, AES-256-GCM sealed** in the artifact
  store (the endpoint URL is sensitive → zero-at-rest); `lib/push-delivery` is the bus effect the notify bus
  fires **ONCE on the origin replica** (lazy-imported, best-effort) — only **personal** notifications
  (addressed to a `sub`) push; broadcasts stay on SSE; a `410/404`-gone subscription is **pruned**.
  `routes/push` (vapid-key / subscribe / unsubscribe, viewer+, `501` when unconfigured) behind a **default-off
  `pushNotifications`** module. Client: `sw.js` gains `push` + `notificationclick` handlers (focus/route an
  open window); `lib/web-push-client` feature-detects + subscribes via `PushManager`; `lib/use-push` + a
  **Notifications on this device** settings card — per-device, off by default, and the subscription is
  **dropped on logout**. **Zero-at-rest preserved**: subscriptions sealed, no keys ⇒ nothing sent. Endpoint
  allow-list / error-classification / config-gate / sealed round-trip / delivery-prune / route tests +
  client capability-probe tests. **Next:** native shells (stretch, backlogged) — Phase 2 otherwise complete.

---

## Phase 3 — deepen what exists only partially

### 3.1 Full interactive scheduling engine  ✅ Done (slices 1–6)
- **Competitors.** MS Project, Smartsheet, Planview. **Have.** Gantt + CPM + baselines +
  Monte-Carlo. **Missing.** Auto-scheduling: working calendars, task constraints
  (SNET/FNLT), lead/lag, drag-a-bar-and-cascade-dependencies.
- **Leverage.** `critical-path.ts`, GanttChart, dependencies lib, baseline.
- **Design.** Stays true to the stateless-overlay thesis: the scheduler is a **pure, client-side,
  projected** computation layer (like `critical-path.ts` / `schedule-scenario.ts`) — no server-side plan
  state, no new backend fields required; every figure is a projection, dates only write back through the
  existing issue-update seam when the user explicitly commits a drag.
- **Slice 1 ✅ (working-calendar engine).** `lib/working-calendar` — a pure model of which whole-day indices
  are **working time** (`workingWeekdays` default Mon–Fri, `holidays`, and `workingExceptions` that force a
  day working and win over weekend/holiday) plus calendar-aware arithmetic: `isWorkingDay`, `nextWorkingDay`/
  `prevWorkingDay`, `addWorkingDays` (skips non-working days, snaps + steps, bidirectional), `workingDaysBetween`
  (half-open, sign-symmetric), and `workingFinish` (last working day a duration occupies). Day indices match
  the shared `DAY_MS` bucketing (day 0 = 1970-01-01 Thu); weekday derived in **UTC** to match `startOfDay`.
  `makeWorkingCalendar` accepts holidays/exceptions as ISO strings or day indices and rejects an empty week.
  13 anchored unit tests. **Next:** task constraints (SNET/FNLT) + lead/lag on the dependency model (slice 2).
- **Slice 2 ✅ (typed dependencies + task constraints).** `lib/schedule-constraints` — the pure, calendar-aware
  primitives a forward pass applies one task / one edge at a time. **Typed dependencies**: FS / SS / FF / SF
  each with a `lagWorkingDays` (negative = lead); `earliestStartFromDependency` returns the successor start a
  placed predecessor imposes (FF/SF derive it from a required finish via `startFromFinish`, the inverse of
  `workingFinish`). **Task constraints**: ASAP / SNET / SNLT / FNET / FNLT / MSO / MFO — `applyConstraint`
  drives the forward pass (SNET/FNET push later, MSO/MFO fix the date, SNLT/FNLT/ASAP leave it) and
  `constraintViolation` reports a breached deadline / must-date. All offsets skip non-working time via the
  slice-1 calendar; still pure + projected (no persistence). 14 anchored unit tests. **Next:** the multi-task
  forward-pass auto-scheduler that topologically composes these (slice 3), then drag-a-bar-cascade (slice 4).
- **Slice 3 ✅ (forward-pass auto-scheduler).** `lib/auto-schedule` — `autoSchedule(cal, {tasks, dependencies,
  projectStartDay})` walks the graph in Kahn topological order and places every task at its **earliest
  working-day start**: the latest of its floor (`earliestStartDay` ?? project start) and every incoming
  dependency's implied start (slice-2 `earliestStartFromDependency`), then its constraint is applied
  (`applyConstraint`) and its finish follows from the working-day duration on the calendar. Each `ScheduledTask`
  carries `driverId` (which predecessor set the start, or null when the floor/constraint did) and
  `violatesConstraint`; the result rolls up `projectStartDay`/`projectFinishDay`, a `violations` list, and a
  `hasCycle` flag. The multi-task generalisation of `schedule-scenario.computeSchedule` — adds calendars,
  FS/SS/FF/SF + lead/lag, and constraints. Cyclic edges are ignored + flagged (trapped nodes still placed);
  self-loops / dangling edges dropped. Pure + projected. 9 unit tests (FS chain + lag, SS/lag, SNET override,
  FNLT breach, floor, cycle, edge hygiene, empty). **Next:** drag-a-bar-cascade Gantt integration (slice 4).
- **Slice 4 ✅ (adapter seam: real issues → engine).** `lib/schedule-adapter` — the ONE place the scheduler
  touches app types, keeping the engine (`working-calendar` / `schedule-constraints` / `auto-schedule`) free
  of them. `issueDurationWorkingDays` (inclusive start→due span in WORKING days, else estimate ÷ 8h, else a
  0-day milestone — mirrors `CriticalPath.durationDays` but calendar-aware); `issuesToScheduleTasks` (anchors
  each task's `earliestStartDay` to its snapped start, attaches an optional per-issue constraint);
  `dependencyEdgesToTyped` (maps the dependency overlay to typed precedence within one project — `blocks` →
  FS from→to, `depends_on` → the reverse, `relates_to` skipped; cross-project / dangling edges dropped). The
  coarse model has no FS/SS/FF/SF or lag yet, so edges default to FS/0 — richer edges layer on without
  changing the seam. Pure + projected. 5 unit tests. **Next:** the read-only auto-scheduled forecast overlay
  wiring real data through the engine on a Gantt (slice 5), then interactive drag-cascade (slice 6).
- **Slice 5 ✅ (auto-scheduled forecast report).** First surface of the engine on real data. `lib/project-
  forecast` — the pure glue (`computeProjectForecast`) that runs `autoSchedule` over a project's live issues
  + dependency overlay and returns ready-to-render rows sorted earliest-start-first; `resolveProjectStartDay`
  floors the plan at the earliest anchored start (else an injected `nowDay`, keeping the maths deterministic).
  `components/reports/AutoScheduleForecast` — a new **built-in report** (catalogue `auto-schedule-forecast`,
  registered renderer) showing projected finish, activity count, breach count, a cycle warning, and a per-
  activity table (start / finish / working days / **driven-by** attribution / constraint status), tinting
  breached rows. Explicitly a projection — a note reminds the user nothing is written back; committing a plan
  means editing the real dates. 4 forecast unit tests + 3 component tests (table/driver, empty, cycle);
  renderer-coverage guard green. **Next:** interactive drag-a-bar-cascade that writes committed dates back
  through the issue-update seam (slice 6).
- **Slice 6 ✅ (interactive drag-a-bar-cascade — completes 3.1).** An **opt-in** "Cascade dependents" toggle
  on the board Gantt (default off ⇒ today's exact single-bar move). `lib/cascade-reschedule` (`computeCascade`)
  — pure **push-only** cascade maths: anchors every task at its CURRENT position (nothing is pulled earlier)
  and isolates a drag's effect by diffing two `autoSchedule` runs (baseline vs dragged-anchor-bumped) so
  pre-existing dependency slack cancels out and only THIS drag's knock-on is written. When the toggle is on,
  releasing a dragged bar computes the per-issue day-shifts and `commitCascade` writes the dragged bar **and**
  every pushed dependent back through the existing issue-update seam in one optimistic move with an
  all-or-revert failure path (any write — incl. a 409 — rolls the whole timeline back). Only shown when the
  backend can store the schedule dates. 6 cascade unit tests (push-later, no-pull-earlier, dependent-only,
  no-deps, zero-drag, knock-on-isolation) + 3 component tests (toggle gating ×2, cascade-writes-both). **3.1
  complete: working calendars, task constraints, lead/lag, and drag-a-bar-and-cascade all shipped.**
- **Follow-up 7a ✅ (configurable working-time — plumbing).** Hours-per-day + the working week/holidays are no
  longer hardcoded (was `HOURS_PER_DAY = 8` in two places, Mon–Fri fixed). New **org setting** `scheduling`
  (`hoursPerDay` ∈ (0,24], `workingWeekdays` 0–6, `holidays` ISO dates) in `lib/settings` — seeded to 8h /
  Mon–Fri, validated (empty week rejected), read through the existing `/api/settings` slice. Client
  `lib/scheduling-settings` (`useSchedulingSettings` + pure `resolveSchedulingSettings`) resolves it to a
  `{ hoursPerDay, WorkingCalendar }` with safe defaults; threaded through `schedule-adapter` /
  `project-forecast` / `cascade-reschedule` (trailing optional param, defaults 8) and consumed by the forecast
  report, the board Gantt cascade, and Critical Path. 5 server validator tests + 3 resolver tests; existing
  suites green (defaults preserve behaviour). **Next:** the admin settings card to edit it (7b).
- **Follow-up 7b ✅ (working-time admin UI).** `components/settings/SchedulingSettingsAdmin` — a **Working time
  (scheduling)** card in Settings: an hours-per-day number input, a Mon→Sun working-week toggle row, and a
  holiday-date add/remove list. Saves the `scheduling` block via `PATCH /api/settings` and invalidates BOTH
  the engine's `["settings"]` slice and the generated settings key so every forecast / Gantt cascade / critical
  path re-plans immediately; Save is disabled until valid (hours ∈ (0,24], ≥1 working day). Registered as the
  `scheduling` admin panel (palette-jumpable). Also fixed a **pre-existing panel drift** (an earlier slice's
  `guestInvite` panel was missing from `SETTINGS_PANEL_KEYS`). 3 component tests (seed, save-PATCH, validation
  gate) + the panel drift-guard now green. **Working-time is now fully user-configurable.**

### 3.2 Goals / OKRs as a managed cadence  ✅ Done (slices 1–5)
- **Competitors.** Asana Goals, Viva Goals, ClickUp. **Have.** Strategy cascade + PI board
  as *reports*. **Missing.** First-class goal objects with check-ins, progress updates,
  goal↔work linking on a cadence.
- **Leverage.** strategy-cascade lib, reminder-sweep/recurrence for check-in cadence.
- **Design.** First-class GOAL objects in the same sealed storage-target store as proofs/whiteboards/wiki
  (user / project / org, AES-256-GCM at rest; no sidecar — a goal is OmniProject-held). Progress is DERIVED
  from key-result attainment server-side, never trusted from the client. Behind a default-off `goals` module.
- **Slice 1 ✅ (goal object foundation).** `lib/goal` — the model + single sanitising choke point: a `Goal`
  is an objective (title/description) + measurable `KeyResult`s (`startValue`→`target`, `current`, `unit`);
  `keyResultAttainment` (0–100, clamped, sign-symmetric for decreasing targets, met-only when start==target)
  and `goalProgress` (mean attainment) derive progress; `sanitizeGoalWrite` bounds/validates every write;
  self-describing ids (`makeGoalId`/`parseGoalId`/`goalScope`) + `newGoalRow`/`mergeGoalRow` (owner + progress
  + version stamped server-side). `routes/goals` — REST CRUD (list/get/create/update/delete) over the storage
  targets, RBAC read viewer+ / author contributor+ / org-writes manager+ via `authorizeStorageTarget`, behind
  the new default-off **`goals`** feature module. 6 pure unit tests + 6 route tests (sealed-at-rest, derived
  progress, version bump, list projection, RBAC floor, delete). **Next:** key-result check-ins + progress
  history (slice 2), goal↔work linking (slice 3), check-in cadence via the reminder sweep (slice 4), UI (5).
- **Slice 2 ✅ (key-result check-ins + progress history).** A check-in is a point-in-time progress update:
  `POST /api/goals/:id/checkin` (contributor+; org ⇒ manager+) updates the named key results' `current`
  values, recomputes progress, optionally sets the status + a note, and appends a **bounded** (`maxCheckIns`
  100) snapshot to the goal's `checkins[]` history. `sanitizeCheckInWrite` caps the note, validates the
  status, and coerces `krValues` (KR id → number, unknown/non-numeric dropped); `applyCheckIn` is pure (id +
  clock injected). `GoalMeta` now carries `checkInCount` + `lastCheckInAt`. 2 more pure tests (sanitise;
  apply incl. history bounding) + 1 route test. **Next:** goal↔work linking (slice 3).
- **Slice 3 ✅ (goal↔work linking).** A goal can link to work items in a system of record, **reference-only**
  (zero-at-rest — an addressing triple `system`/`projectRef`/`itemRef` + an optional cached label, never the
  item's content), like the dependency overlay. `GoalLink` carries a stable URL-safe `key` (`goalLinkKey` =
  base64url of the triple) so links are idempotent + deletable by key. `POST /api/goals/:id/links` (add,
  idempotent, bounded to `maxLinks` 200) and `DELETE /api/goals/:id/links/:key` (unlink), both contributor+.
  `sanitizeGoalLink` validates the triple; `addGoalLink`/`removeGoalLink` are pure and bump the version only
  on a real change. `GoalMeta` gains `linkCount`. 1 pure test + 1 route test. **Next:** the recurring check-in
  cadence via the reminder sweep (slice 4), then the UI (slice 5).
- **Slice 4 ✅ (check-in cadence — managed reminders).** A goal can carry a `cadence` (recurrence rule) and a
  derived `nextCheckInAt`; `newGoalRow` seeds it via `recurrence.nextOccurrence`, `mergeGoalRow` reseeds when
  the cadence changes, and `applyCheckIn` rolls it forward on each check-in. A **portfolio-wide sweep**
  (`POST /api/goals/checkins/sweep`, **pmo+**, cron/routine-driven) enumerates every goal across all scopes
  (new `artifact-store.listAllArtifactCollections` scans the sealed type dir), and `runGoalCheckinSweep`
  mark-then-notifies the OWNER of each due goal via the **notify bus** (deduped through `sharedKv` with a
  fire-key that embeds the due date) and **rolls the cadence forward** so it recurs even if a check-in is
  missed — exactly mirroring the task reminder sweep. Pure selection (`dueGoalCheckins`, `advanceGoalCadence`,
  `goalCheckinNotification`) + injected runner. 5 pure tests (seed/advance, due-selection, roll-forward,
  sweep-nudges-owner) + 1 route test (seed + sweep + pmo gate). **Next:** the Goals UI (slice 5).
- **Slice 5 ✅ (Goals UI — completes 3.2).** `lib/goals` — React Query hooks over `/api/goals/*` (list / get
  / create / update / **check-in** / **link** / unlink / delete) + shared types & status tones. `pages/Goals`
  — the authoring surface: a goal list with derived-progress bars + status badges + next-check-in, a create
  form (objective, description, dynamic key results, cadence, private/org storage), and a detail panel to
  **check in** (edit each key result's current value + a note + status → one call updates KRs, recomputes
  progress, rolls the cadence), manage **linked work** (add/remove by system/project/item ref), and view the
  **check-in history**. Wired as a `/goals` route + a primary nav item gated on the **`goals`** feature module
  (nav-order drift guard + `nav.goals` in 4 locales updated). 3 page tests (list, empty, create-toggle);
  nav/i18n guards green; typecheck clean. **3.2 complete: first-class goals with key results, check-ins,
  goal↔work linking, and a managed check-in cadence — all as a sealed, projected overlay.**
- **Follow-up ✅ (key results as a first-class primitive family).** Aligned goals with the "everything is a
  primitive/class in the unified store" architecture (like proofs → the `annotation` family on the `proof`
  surface). New `backend-catalogue/goal-catalogue` is the single source of truth: `KEY_RESULT_KINDS`
  (`number` / `percent` / `currency` / `milestone`), `BINARY_KEY_RESULT_KINDS` + `isBinaryKeyResultKind`, and
  the shared presentational method `formatKeyResultValue(kind, value, unit)`. `primitive-store` gains the
  **`keyResult` family** (from `KEY_RESULT_KINDS`) placeable on a new **`goal` placement surface**, drift-
  guarded (`primitive-store.test` binds the family to the catalogue + the surface). A `KeyResult` now carries
  a `kind`; `keyResultAttainment` is kind-aware (milestone is binary met/not, the rest roll proportionally),
  validated server-side (unknown kind → `number`). Client + Goals authoring UI pick a kind per key result and
  render values via the catalogue formatter. 2 catalogue tests + drift-guard + server attainment/sanitise
  tests; both packages typecheck clean.

### 3.3 Live time tracking + invoicing  ✅ Done (slices 1–3)
- **Competitors.** Harvest/Toggl, Workfront. **Have.** Timesheets (submit/approve) +
  income/invoicing reports. **Missing.** Start/stop timers, invoice generation.
- **Leverage.** timesheet lib, income/invoicing reports, financials.
- **Design.** A running timer is EPHEMERAL per-user state on the shared-state KV seam (not the durable store);
  an INVOICE is OmniProject-held ⇒ the sealed artifact-store + primitive pattern (like goals), with line
  pricing resolved through the existing rate-card engine. Behind default-off modules.
- **Slice 1 ✅ (running timer).** `lib/timer` — a per-user clock in the shared-state KV (`timer:running:<sub>`,
  TTL-bounded 24h so a forgotten clock can't run forever): pure `sanitizeTimerStart` (needs a projectId),
  `elapsedHours` (2dp, never negative on skew), `timerToEntry` (materialise a day-grained timesheet entry on
  stop). `routes/timer` — GET (current + live elapsed) / POST start / POST stop, contributor+, behind the new
  default-off **`timeTracking`** module. Client `lib/live-timer` hooks (`useTimer` polls while running,
  `useStartTimer`/`useStopTimer`) + `TimerWidget` in the app topbar (ticks locally between server polls; idle
  start-form ↔ running elapsed + stop; feature-gated). 4 pure + 3 route tests + 2 widget + formatElapsed
  tests. **Next:** book the stopped entry into the timesheet (slice 2), the invoice object (3), generation (4).
- **Slice 2 ✅ (invoice object + `invoiceLine` primitive family).** A first-class generated INVOICE on the
  sealed storage-target store, primitive-aligned like goals. New `backend-catalogue/invoice-catalogue`:
  `INVOICE_LINE_KINDS` (labour / expense / fixed / discount), `INVOICE_STATUSES` (draft → issued → paid →
  void), and the pure money methods `invoiceLineAmount` (qty × price; a **discount is always ≤ 0**) + `round2`
  + `formatMoney`. `primitive-store` gains the **`invoiceLine` family** placeable on a new **`invoice`
  surface**, drift-guarded. Server `lib/invoice` — the model + single sanitiser: a line's `amount` and the
  invoice `subtotal`/`taxAmount`/`total` are **derived server-side** (never client-trusted); project/org
  storage only (an invoice is never personal); self-describing ids. `routes/invoices` — CRUD, **manager+**
  throughout (financial docs), only a **draft** may be edited (409 otherwise), behind the new default-off
  **`invoicing`** module. 3 catalogue + 3 pure + 3 route tests + drift guard; all three packages typecheck
  clean. **Next:** invoice generation from billable timesheet hours × rate card + status flow + UI (slice 3).
- **Slice 3 ✅ (invoice status flow + UI — completes 3.3).** Server: `INVOICE_TRANSITIONS` + `canTransitionInvoice`
  + `applyInvoiceStatus` (draft→issued→paid, live→void; stamps `issuedAt`/`paidAt`; terminal states closed) and
  `POST /api/invoices/:id/status` (manager+, 409 on an illegal move). Client: `lib/invoices` hooks (list / get /
  create / update / setStatus / delete) + `pages/Invoices` — a list with derived totals + status badges, a
  create form with a typed **line editor** (kind × qty × price, live amount + subtotal preview) and derived
  server-side totals, and a detail panel with the line table, subtotal/tax/total, and the **issue → paid / void**
  actions. Wired as an `/invoices` route + a primary nav item gated on the **`invoicing`** module (nav-order
  guard + `nav.invoices` i18n). 1 status pure + 1 status route test + 3 page tests. **3.3 complete: a live
  start/stop timer + first-class invoices (typed line primitives, derived totals, lifecycle). Auto-generating
  invoice lines from billable timesheet actuals × the rate-card engine is a natural follow-up.**

### 3.4 Third-party app / plugin marketplace  ✅ Done (slices 1–2)
- **Competitors.** Jira/Monday/Asana marketplaces. **Have.** 41 connectors + MCP + broker
  seam. **Missing.** UI-extension ecosystem (installable panels/screens/reports).
- **Leverage.** Panel registry, screen-def bundles, MCP, config-bundle delivery.
- **Design.** An installed EXTENSION is a JSON manifest of typed **contribution primitives** — all pure-JSON
  config the app already renders (a custom report / content page / dashboard / screen), **no executable code**
  — so installing one is a governance decision, not a deploy. Org-wide config in the sealed store; **optional,
  default-off** (nothing to show until an admin installs something — there are no built-in plugins). Primitive-
  aligned like goals/invoices.
- **Slice 1 ✅ (extension model + `extensionContribution` primitive family + install routes).** New
  `backend-catalogue/marketplace-catalogue`: `EXTENSION_CONTRIBUTION_KINDS` (report / contentPage / dashboard /
  screen), `EXTENSION_STATUSES` (installed / disabled), `contributionKindLabel`. `primitive-store` gains the
  **`extensionContribution` family** placeable on a new **`marketplace` surface**, drift-guarded. Server
  `lib/extension` — the model + single sanitiser: an extension manifest (name/publisher/version + ≥1 typed
  contribution, each a bounded pure-JSON `def`), stored **org-scoped** in the sealed store; `activeContributions(kind)`
  is the read hook that surfaces installed (not-disabled) extensions' parts. `routes/marketplace` — list/get
  (manager+) + install/status/uninstall (**admin** — a governance action), behind the new default-off
  **`marketplace`** module. 2 catalogue + 2 pure (incl. store round-trip + active/disabled) + 3 route tests +
  drift guard; all three packages typecheck clean. **Next:** the marketplace UI + surfacing contributions into
  the report/content catalogues (slice 2).
- **Slice 2 ✅ (marketplace UI — completes the 3.4 MVP).** `lib/marketplace` hooks (`useExtensions` /
  `useExtension` / install / setStatus / uninstall) + `pages/Marketplace` — a `/marketplace` admin surface:
  the installed-extension list (status + contribution kinds), an **install-from-manifest** form (paste JSON,
  client-side validity guard before the server round-trip), and per-extension **enable/disable** + **uninstall**
  actions. Wired as an admin-group nav item gated on the **`marketplace`** module + pmo/admin visibility
  (nav-order + admin-shelf drift guards + `nav.marketplace` i18n). 3 page tests (list, empty, bad-JSON guard);
  nav/i18n guards + typecheck green. **3.4 MVP complete: an optional, default-off, admin-governed marketplace
  for installing pure-JSON extensions. Auto-surfacing installed contributions into the live report/content
  catalogues (via `activeContributions`) is a natural follow-up.**

### 3.5 Org registry of approved bespoke items + community-release seam  ✅ Done (slices 1–3)
- **Rationale.** Orgs accumulate bespoke building blocks — custom reports, screens, dashboards, forms,
  **primitives** and raw **JSON defs**, plus extension **plugins** — scattered across users and projects. There's
  no curated, org-wide place to collect the *approved* ones for reuse, and no path (when an org chooses) to share
  them with a wider community. This is the internal **app store of vetted config**, ready to connect to an
  as-yet-unbuilt **online marketplace**.
- **Design.** A registry item is a typed, **pure-JSON building block** (`template` / `report` / `primitive` /
  `plugin` / `screen` / `dashboard` / `form` / `jsonDef`) — no executable code — that moves through a small
  lifecycle: **submit** (contributor+) → **review** approve/reject (admin) → optionally **release to the
  community** (admin). Items are **org-wide** config in the sealed store. The community-release step calls a
  **connector seam** (`community-marketplace`, like the broker): the default is *unconfigured* — release still
  completes locally (the item is marked `community`, queued) and publishes for real once an online marketplace is
  wired. **Optional, default-off** (`registry` module). Primitive-aligned like everything else.
- **Slice 1 ✅ (registry model + `registryItem` primitive family + lifecycle routes + community seam).** New
  `backend-catalogue/registry-catalogue`: `REGISTRY_ITEM_KINDS` (8 kinds), `REGISTRY_APPROVAL_STATUSES`
  (draft / approved / rejected), `REGISTRY_VISIBILITIES` (internal / community), `registryItemKindLabel`.
  `primitive-store` gains the **`registryItem` family** placeable on a new **`registry` surface**, drift-guarded.
  Server `lib/registry` — the model + single sanitiser (`sanitizeRegistrySubmit`): bounded name/publisher/version
  /tags + a size-capped pure-JSON `payload`; identity/review/release stamped server-side; the
  `submit→review→release→retract` transitions + `approvedRegistryItems(kind)` / `communityRegistryItems()` read
  hooks over the sealed org store. `lib/community-marketplace` — the **future-marketplace connector seam** (default
  `UNCONFIGURED` no-op publish + `register`/`reset`/`get`). `routes/registry` — list/get (viewer+, non-admins see
  only approved + their own), submit (contributor+), review/release/retract (admin), `community/status`, delete
  (admin or own-draft), behind the new default-off **`registry`** module. 2 catalogue + 9 pure model + 2 seam +
  6 route tests (incl. sealed-at-rest, visibility, RBAC negatives) + drift guard; all three packages typecheck
  clean.
- **Slice 2 ✅ (reference skeletons — so people can build their own).** The reference designs are heavily-commented
  **`.jsonc` skeletons** committed in the repo under **`reference-designs/`** (primitives / screens / forms /
  reports / dashboards). They are **pure reference material — the app never loads, reads, or serves them**; there
  is no endpoint and no build step. Each skeleton carries the submission envelope + a payload shaped like the real
  thing (grounded in the actual `PrimitiveDef` / `OrgScreenDef` / `FormDef` formats), with inline `//` comments
  explaining every field and the `<PLACEHOLDER>` values to fill. An author copies a skeleton, strips the comments,
  fills the placeholders, and submits — the real `sanitizeRegistrySubmit` + def-validators run on the SUBMIT path
  and reject anything malformed there. `reference-designs/README.md` + `docs/REFERENCE-DESIGNS.md` are the guides.
  _(Correction from an earlier take: reference designs were briefly a loaded module + `/registry/reference`
  endpoint + UI panel — all removed; they are static repo skeletons only.)_
- **Slice 3 ✅ (registry UI — completes 3.5).** SPA `lib/registry` hooks (`useRegistry` / `useRegistryItem` /
  `useCommunityStatus` + submit / review / release / retract / delete) and `pages/Registry` — a `/registry` surface:
  the visible-items list, an **admin review queue** (approve/reject drafts), **release-to-community** + **retract**
  toggles with a community-connection indicator, and a paste-JSON submit form with a client-side validity guard (it
  points authors at the repo's `reference-designs/` skeletons). Admin actions are role-gated (`roleAtLeast(admin)`);
  non-admins see approved items + their own. Wired as an admin-group nav item gated on the **`registry`** module +
  pmo/admin visibility (nav-order + admin-shelf drift guards + `nav.registry` i18n + `/registry` route). 5 page
  tests (list, review queue, release control, non-admin gating, JSON guard, empty state); nav/i18n guards +
  all three packages typecheck clean.

---

## Cross-cutting

### X.1 Native handoff (companion-app bridge)  🚧 In progress (slices 1a–2 of 4) — full design in `docs/NATIVE-HANDOFF.md`
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
- **Slice 1a ✅ (the contract + reference broker path + routes).** The broker contract gains the sketched types
  (`NativeSurfaceKind`, `NativeSurface`, `NativeContextRef`, `NativeHandoffRequest`, `NativeHandoff`,
  `NativeImportRequest`) + three **optional** `Broker` methods (`nativeSurfaces` / `nativeHandoff` /
  `nativeImport`). `lib/native-handoff` holds the security-critical bits: a **vendor→host allowlist**
  (`VENDOR_HOSTS`), `buildVendorUrl` (a handoff URL is built ONLY against the vendor's allowlisted host, and an
  `externalRef` full URL is accepted only when its host matches — no off-host redirect / SSRF pivot), and the
  request sanitisers. `DemoBroker` implements all three (an illustrative `demoboard` vendor) so the reference
  flow runs end to end. `routes/native` — `GET /native/surfaces` (viewer+, empty when none), `POST
  /native/handoff` + `POST /native/import` (contributor+, 501 when the broker doesn't front it), audited —
  behind the new default-off **`nativeHandoff`** module. 6 lib + 5 route tests (surfaces, minted host-allowlisted
  URL, bad-vendor 400, reference attachment, RBAC); broker-conformance / contract / features / compat guards
  green; typecheck clean.
- **Slice 1b ✅ (the `<UseNative>` SPA control).** `lib/native` client hooks (`useNativeSurfaces` over
  `GET /api/native/surfaces`, `useNativeHandoff` / `useNativeImport`) + the reusable capability-gated
  `<UseNative kind contextRef>` control (`components/native/UseNative`). Purely surface-driven: renders one
  button per connected vendor that fronts this artifact `kind`, and **nothing at all** when the module is off
  or nothing advertises the kind (safe to place anywhere). Clicking hands off — opens the minted,
  host-allowlisted URL in the user's own browser (`window.open` `noopener,noreferrer`) — then offers to bring
  the reference back as an attachment on the anchoring project/issue. Placed in the Whiteboards page header
  (`kind="whiteboard"`, anchored to the convert-target project). 4 component tests (renders nothing with no
  matching surface, one button per vendor, handoff→attach round-trip, no attach without a project context);
  SPA typecheck clean.
- **Slice 2 ✅ (sandboxed Live-Embed preview — Tier 2).** For a surface that advertises the `embed` action, the
  control offers an inline **PREVIEW**: `native-handoff.buildEmbedUrl` mints the vendor's Live-Embed URL against
  the same **allowlisted host** invariant (a full `externalRef` is accepted only when its host matches),
  `DemoBroker` returns it as `NativeHandoff.embedUrl` on the `embed` action, and `<UseNative>` loads it into a
  **sandboxed `<iframe>`** (`sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`,
  `referrerPolicy=no-referrer`) isolated from our origin, with a close control. Defence-in-depth on the framing
  boundary: CSP gains a strict **`frame-src 'none'` default** + an operator `CSP_FRAME_SRC` allowlist knob (which
  **replaces** `'none'`, since appending a source to `'none'` is invalid CSP) — so a vendor embed only renders
  where the deployment has explicitly allowlisted that host. 1 lib test (`buildEmbedUrl` host-allowlisted +
  off-host/http rejected), 1 route test (embed handoff mints `embedUrl`), 2 CSP tests (default `frame-src 'none'`;
  `CSP_FRAME_SRC` replaces), 2 component tests (sandboxed iframe with the minted src + sandbox attrs, closes; no
  embed affordance without the `embed` action); both packages typecheck clean. **Next:** slices 3–4 (OAuth +
  content import via `safeFetch`, screenshot + AI-vision fallback).

### X.2 AI primitive-authoring studio (companion skill)  ✅ Done (slices 1–4)
- **Rationale.** Primitives + JSON defs are the app's building blocks, but authoring one means knowing the
  shape. A **companion AI skill** takes a plain description (later: a description + a picture), **builds** a
  primitive JSON bundle, **tests** it against the real schema, **renders** it back, and **iterates** on the
  user's feedback until they're happy — then writes the bundle into the registry (submit → admin review). AI
  proposes, human disposes; the model never emits code, only a declarative primitive descriptor.
- **Design.** Reuses the AI seam (`aiChat` / a `complete` callback + defensive-JSON parse, like
  `backend-suggest`), the chart-render surfaces (`ArtifactRenderer` / `ChartView`) for the live preview, and
  the registry submit path (`sanitizeRegistrySubmit`) for the write. Governed like every AI surface (default-off
  feature module + a governed capability + `requireRole(contributor)`), never a new security boundary.
- **Slice 1 ✅ (the deterministic "test" — shared primitive-bundle schema + validator).** New
  `backend-catalogue/primitive-schema`: the closed sets a primitive payload may use — `PRIMITIVE_CATEGORIES`
  (chart / graphic / table / tile), `PRIMITIVE_PARAM_TYPES` (rows / series / … / enum), `CHART_VIEW_TYPES`
  (bar / line / … / gantt) — plus `validatePrimitiveDef(raw)`, a pure validator that **collects every problem**
  (never throws) and returns the normalised `PrimitiveDefShape` when clean. This is the deterministic test the
  skill runs on any generated/pasted bundle before it may be stored. A **drift guard** in the SPA
  (`charts/catalogue.drift.test`) asserts the shipped `PRIMITIVE_CATALOGUE` (the runtime rendering side) only
  ever uses these sets, so the validator can't diverge from what actually renders. 5 catalogue + 2 drift tests;
  backend-catalogue + SPA typecheck clean.
- **Slice 2 ✅ (the server skill — AI generate → validate → feedback).** `lib/primitive-studio`: the "skill" —
  `primitiveStudioSystemPrompt` (the exact schema + closed sets + a NEVER-emit-code contract), `buildPrimitiveMessages`
  (carries the previous payload + feedback for iteration), `parsePrimitiveReply` (defensive `extractJson`, identity
  fields defaulted not trusted), and `generatePrimitiveBundle(input, complete)` — an **injectable** orchestrator that
  generates then runs the slice-1 `validatePrimitiveDef` and returns `{ submission, valid, errors, def }` (never throws
  on an invalid primitive; only a non-JSON reply raises `PrimitiveStudioParseError`). `routes/studio` — `POST
  /studio/primitive` (generate+validate) + `GET /studio/status`, behind the default-off **`studio`** feature module,
  governed like every AI surface: the active `provider:*` capability + the new **`ai-authoring`** capability (both
  off by default) + `requireRole(contributor)`. Follows "AI proposes, human disposes" — it only generates + tests;
  the write goes through the existing registry submit path. 6 pure (injected `complete`) + 4 route (governance gate,
  400, RBAC) tests; feature/capability/governance suites green; api-server typecheck clean.
- **Slice 3 ✅ (the companion studio UI).** SPA `lib/studio` (`useStudioStatus` / `useGeneratePrimitive`) + `pages/Studio`
  — the `/studio` surface: **describe** a chart/graphic → **generate** → a **verdict** (valid ✓ or the exact validation
  errors) + a **live preview** (a sample `ChartView` for the primitive's chart type, else a params summary) + the bundle
  JSON → **refine** with feedback and regenerate (feeding the previous payload back) → **submit to the registry** (reuses
  `useSubmitRegistryItem`; the button is enabled only when the primitive is valid). Wired as a primary-group nav item
  gated on the **`studio`** module (`/studio` route + `nav.studio` i18n + nav-order guard). 3 page tests (unavailable
  warning, valid→preview→submit-enabled, invalid→errors→submit-disabled); full SPA suite + typecheck clean. **Next:**
  slice 4 — image input (extend the `aiChat` vision chokepoint so a picture + description can seed a primitive).
- **Slice 4 ✅ (image input — completes X.2).** Extended the shared `aiChat` seam for vision **additively**:
  `ChatMessage` gains an optional `images?: ChatImage[]`, and each provider adapter maps through a small helper
  (`toOpenAiMessages` / `toAnthropicMessages` / `toOllamaMessages`) — with no image the body is byte-identical
  to before, with one it becomes that provider's native shape (OpenAI `image_url` data-URI parts, Anthropic
  base64 image blocks, Ollama sibling `images` array). DLP redaction already spreads the message so images
  survive; token/budget estimation reads only text (images uncounted — noted). `primitive-studio` threads an
  optional `image` onto the user turn; `routes/studio` accepts a bounded, MIME-allowlisted `image` (png/jpeg/
  webp/gif, ≤~4.5 MB); `pages/Studio` adds an attach-image control (file → base64) with a thumbnail + remove,
  sent with generate/refine so **a picture + description** seeds the primitive. 5 vision-mapper tests
  (backward-compat + per-provider shape) + a skill image-attach test; api-server + SPA typecheck clean.
  **X.2 complete: describe (or sketch) → build → test → render → iterate → submit, end to end.**

### X.3 The definition importer — one validated path into the scoped encrypted stores  ✅ Done (slices 1–3)
- **Principle.** *Anything a user defines in JSON must go through one importer* so it can land in a **per-user**,
  **project-wide**, or **org-wide** encrypted store — never hand-dropped into an encrypted folder, never stored
  unvalidated. This makes the "validate at the boundary → authorize + stamp → encrypt-and-write" pipeline a
  single, reusable choke point for every user-defined def kind (not just charts).
- **Design.** Reuses what already exists: the AES-256-GCM sealed, scoped `artifact-store` (user/project/org
  files) + the shared `authorizeStorageTarget` gate (own area always; project by project scope; org by
  manager+). The new bit is the **kind-aware validation layer**: each def kind is validated by the REAL product
  validator before the store sees it. Distinct from `/api/import` (the tabular data importer: spreadsheet/SQL
  rows → work items) — this is DEFINITIONS → the sealed def stores.
- **Slice 1 ✅ (the importer core — lib + routes).** `lib/def-import`: `DEF_KINDS` (primitive / screen / form /
  report / dashboard / jsonDef); `validateDef(kind, payload)` dispatches to the real validators
  (`validatePrimitiveDef` / `validateScreenDefs` / `validateForms`; a structural check for report/dashboard/
  jsonDef until they get bespoke validators) and **collects every error**; `sanitizeDef` is the single choke
  point (kind + bounded name + size-capped payload + per-kind validity, throwing `DefError` → 400);
  `newStoredDef` / `storedDefMeta` + scoped store helpers. `routes/defs` — `POST /defs/validate` (dry-run),
  `POST /defs` (validate → the shared target gate → sealed write at the chosen scope), `GET /defs` (aggregated
  across the caller's user + org + in-scope project areas, payload omitted), `GET /defs/:id`, `DELETE /defs/:id`
  — behind the default-off **`defImporter`** module. Read viewer+, author/delete contributor+, org target
  manager+. 5 pure + 4 route tests (validate dry-run, sealed-at-rest user round-trip, bad payload/target 400,
  org-target RBAC). api-server typecheck clean.
- **Slice 2 ✅ (the importer UI — a usable surface).** SPA `lib/defs` (`useDefs` / `useValidateDef` /
  `useImportDef` / `useDeleteDef`) + `pages/Definitions` — a `/definitions` surface: pick a **kind**
  (primitive / screen / form / report / dashboard / jsonDef) + a **storage target** (my private area / a
  project / org-wide), paste the JSON, **Validate** (dry-run against the real schema, shows every error), then
  **Save to store** (through the importer → sealed at the chosen scope). Lists the stored defs (kind + scope)
  with delete. Client-side JSON-parse guard before any request. Wired as an admin-group nav item gated on the
  **`defImporter`** module + pmo/admin visibility (`/definitions` route + `nav.definitions` i18n + nav-order/
  admin-shelf drift guards). 5 page tests (list, parse guard, dry-run errors, save gating, project-id reveal);
  nav/i18n guards + SPA typecheck clean.
- **Slice 3 ✅ (the Studio saves through the importer — completes X.3).** The AI Studio's "submit" now routes
  through the **definition importer** (`useImportDef`) instead of a separate path: a **scope picker** (my private
  area / org-wide) sits beside the save button, and a valid generated primitive is written to that scoped
  encrypted store (`POST /defs`) — so even AI-authored JSON goes through the one validated choke point. 4 page
  tests incl. a save-through-importer assertion; SPA typecheck clean. **X.3 complete: every user-defined JSON
  definition — pasted or AI-authored — flows through one validated importer into the per-user / project / org
  encrypted stores.** (Future: generalise the Studio's AI generation beyond primitives — the importer + the
  Definitions page already accept screen/form/report/dashboard/jsonDef today.)

### X.4 Definition editing, configurable permissions, and universal JSON coverage  ✅ Done (slices 1–3)
- **Goal.** Round out the importer into a full lifecycle: an **editor** (read + edit existing defs, not just
  create), an **admin-configurable permission model** per scope, and coverage of **everything** a user or admin
  can write in JSON — business rules, colour themes, fonts — through the same one validated path.
- **Permission defaults (admin-configurable).** Who may WRITE at each scope: `user` → any author
  (`contributor`); `project` → a PM (`manager`, which PMO/admin also clear); `org` → `pmoOrAdmin` (either
  governance authority — a plain manager is NOT enough). Reads stay at the scoped viewer+ visibility. An admin
  can raise or relax any scope's gate.
- **Slice 1 ✅ (the configurable scope policy).** `lib/def-policy`: `DefScopePolicy { user, project, org }` over
  the gate set `contributor | manager | pmoOrAdmin | admin`, with the defaults above; `satisfiesDefGate` maps a
  gate to the RBAC check (`pmoOrAdmin` = the pmo **or** admin authority, which — like every authority — needs
  strong-auth proof); `getDefScopePolicy` / `setDefScopePolicy` persist the policy as **org config in the sealed
  store** (dogfooding the importer's own storage); `authorizeDefWrite` is the shared write gate (per-scope gate +
  project scope for `project`). `routes/defs` now gates every write (POST + DELETE) through it, and exposes
  `GET /defs/policy` (viewer+ — the UI shows what each scope needs) + `PUT /defs/policy` (**admin** — altering the
  permission model). 4 policy-route tests (defaults; manager-blocked-but-pmo/admin-allowed at org; only-admin-can-
  change; admin relaxes org→manager and a manager may then write) + the existing importer suite updated for the
  stricter org default. api-server + guards + typecheck clean.
- **Slice 2 ✅ (the editor — edit existing defs in place).** Server `lib/def-import` gains `sanitizeDefUpdate`
  (re-validate the payload against the def's **fixed** kind; name optional) + `updateStoredDef` (payload/name
  replaced, rowVersion bumped); `routes/defs` adds `PUT /defs/:id` — load the scoped def, **write-gate through
  the same `authorizeDefWrite` policy** at the def's own scope, re-validate, persist (404 for a missing def, 400
  for an invalid edit). SPA `lib/defs` gains `useDef` (load one with payload) + `useUpdateDef`; `pages/Definitions`
  gains an **edit-in-place panel** — an Edit button on each row loads the def, seeds a JSON editor + name field,
  Validate (dry-run) → Save changes (PUT), Cancel. 1 route test (re-validate + rowVersion bump + kind kept +
  invalid-400 + missing-404) + 1 page test (opens the editor seeded with the payload); api-server + SPA typecheck
  clean.
- **Slice 3 ✅ (business rules, colours, fonts — universal coverage).** Added three def kinds so *everything a
  user or admin can write in JSON* flows through the one importer: **`businessRule`**, **`theme`** (colours), and
  **`font`**. `validateDef` gains their validators — `businessRule` (structural, needs an id), `theme` (an id + a
  `colors` map whose every value must be a string, so a theme can't smuggle a non-string/executable into the
  styling layer), `font` (needs id + family). Wired through both `DEF_KINDS` lists (server + SPA) and the
  Definitions kind picker (with labels). 1 lib test (rules/themes/fonts validate, bad shapes rejected); api-server
  + SPA typecheck clean. **X.4 complete: read + edit existing defs, an admin-configurable per-scope permission
  model, and every user/admin-writable JSON kind — primitives, screens, forms, reports, dashboards, business
  rules, colour themes, fonts — flowing through one validated importer into the scoped encrypted stores.**

### X.5 Surface the admin-editable permission model (roles/groups)  ✅ Done (slices 1–2)
- **Finding.** A stock-take of the RBAC surfaces showed the permission model is *mostly* already system-wide
  and admin-editable — but not uniformly reachable: **capability governance** (permission sets: the capability ×
  surface matrix) is fully surfaced (`GovernanceAdmin`), and per-collection edit-roles are surfaced
  (`ScreensAdmin`); the **group → role mapping** existed only in the backend (`routes/role-map` +
  `lib/rbac` `getRoleMap`/`setRoleMap`/`rollback`, sealed + four-eyes + step-up gated) with **no admin UI** —
  an admin had to `curl PUT /admin/role-map`. (Custom roles are deliberately NOT editable: the 6 roles are a
  hard-coded, statically-verifiable boundary; admins assign groups to fixed roles, they can't invent roles.)
- **Slice 1 ✅ (the group → role mapping editor).** SPA `lib/role-map` (`useRoleMap` + `saveRoleMap` /
  `rollbackRoleMap` + `parseGroups`) + `components/settings/RoleMapAdmin` — a new **`roleMap` Settings panel**:
  per claim-mappable role (guest excluded — it's invite-only), the IdP groups that confer it, each tagged
  env-baseline vs admin-override, editable and **saved behind the same step-up gate** (four-eyes when dual
  control is configured) with an **undo** when a rollback is available. Admin-gated (the gateway also enforces
  it). Registered in `ADMIN_PANELS` + `SETTINGS_PANEL_KEYS` (drift-guarded). 4 tests (renders the roles + source,
  hides guest, local edits, non-admin renders nothing, `parseGroups`); settings drift guard + SPA typecheck
  clean.
- **Slice 2 ✅ (surface the def-scope policy).** SPA `lib/def-policy` (`useDefPolicy` + `saveDefPolicy`) +
  `components/settings/DefPolicyAdmin` — a new **`defPolicy` Settings panel**: a per-scope gate selector (per-user
  / project / org → contributor / manager / pmoOrAdmin / admin) over the existing `GET`/`PUT /defs/policy`, so the
  importer's write permissions are editable from the UI (previously backend-only). Admin-gated, save-on-change,
  and it hints to enable the `defImporter` module when the policy can't be loaded. Registered in `ADMIN_PANELS`
  + `SETTINGS_PANEL_KEYS` (drift-guarded). 4 tests (current values, save-on-change, module-off shell, non-admin
  empty); settings drift guard + SPA typecheck clean. **X.5 complete: the admin-editable permission model —
  capability governance (permission sets), the group → role mapping, per-collection edit-roles, and the
  definition-importer scope policy — is now all reachable from the admin Settings UI.**

### X.6 Admin-defined custom roles + permission sets  ✅ Done (slices 1–4)
- **Goal.** Let an org name its own roles ("Finance Analyst", "Delivery Lead") and permission bundles — while
  keeping the RBAC boundary statically verifiable. **A custom role is always GROUNDED in one of the 6 fixed base
  roles** (its hard grant ceiling), so it can never confer more than that base — which an admin could already
  grant via the role-map; this only labels + bundles it. A **permission set** is a named bundle of governance
  **capability** ids a custom role includes.
- **Slice 1 ✅ (model + storage + admin CRUD).** `lib/custom-roles`: `PermissionSet { id, label, capabilities[] }`
  + `CustomRole { id, label, baseRole, permissionSetIds[], groups[] }` + `CustomRolesConfig`; `CUSTOM_ROLE_BASES`
  (the fixed roles minus `guest`); `sanitizeCustomRolesConfig` — the choke point enforcing **referential
  integrity** (kebab ids, no collision with a built-in role, `baseRole` ∈ the fixed set, every capability id real
  via `getCapability`, every `permissionSetId` resolvable); `get`/`setCustomRolesConfig` persist org-wide in the
  sealed store; `customRolesForClaims` / `capabilitiesForCustomRoles` are the resolution helpers (wired next
  slice). `routes/custom-roles` — `GET`/`PUT /admin/custom-roles` (admin-only, mounted as a core admin route
  like `role-map`), returning the base-role + capability pickers the editor needs. 8 tests (validator rejects bad
  base / built-in collision / unknown capability / dangling ref / guest base; resolution helpers; route CRUD +
  admin-only RBAC + persistence); guards + gateway + typecheck clean.
- **Slice 2 ✅ (resolution — group → custom role → base grants, enforced).** `rbac` gains a `unionGrants` helper
  (higher base + union of authorities) and a **registration seam** (`registerCustomRoleGrants`) so it never
  imports `custom-roles` (avoiding a load-time circular import). `grantsForReq` now folds the matched custom
  roles' grants into the fixed-claim grants — each custom role capped at its base role via `grantsForRole`, and
  **authorities (pmo/admin) still withheld without strong auth**, exactly like a direct claim; demo sessions
  (all-grants) are untouched. `lib/custom-roles` registers `customRoleGrants` at load (via the route mount at
  startup). Net: an IdP group mapped only to a custom role now resolves through EVERY existing `requireRole` /
  `hasRole` gate — with a hard ceiling of the base role an admin could already assign directly. New resolution
  test (a `finance`-group user with no fixed-role claim is lifted to the custom role's base of `manager`); the
  full RBAC suite (enforcement + strong-auth + SSO parity + gateway = 156 tests) stays green; typecheck clean.
- **Slice 3 ✅ (the admin UI — completes X.6).** The `PUT /admin/custom-roles` route is now **step-up gated**
  (matching the role-map — custom roles resolve into real grants). SPA `lib/custom-roles` (`useCustomRoles` +
  `saveCustomRoles`) + `components/settings/CustomRolesAdmin` — a new **`customRoles` Settings panel**: a
  permission-sets editor (id + label + capability checkboxes, add/remove) and a custom-roles editor (id + label +
  base-role select + permission-set checkboxes + the IdP groups textarea, add/remove), saved behind `withStepUp`.
  Server validation stays authoritative (referential integrity, no built-in collisions). Registered in
  `ADMIN_PANELS` + `SETTINGS_PANEL_KEYS` (drift-guarded). 4 component tests (renders config, add set/role, remove
  role, non-admin empty); settings drift guard + SPA typecheck clean. **X.6 complete: admins can define their own
  permission sets (capability bundles) and custom roles — each grounded in a fixed base role so the RBAC ceiling
  stays statically verifiable — assign IdP groups to them, and the mapping resolves through every existing gate.**
- **Slice 4 ✅ (permission sets enforce capabilities per-principal).** A permission set's capabilities now
  actually turn on for a custom role's members. `capability-governance` — `decideCapability` / `enforceCapability`
  take an optional `granted` set; when a capability's org/surface state is `off` but the caller's grant set
  includes it, the gate is **lifted** (the stored state is unchanged — no invented config; audited with
  `grantedByPermissionSet`). `rbac` exposes `roleClaimsForReq`; `custom-roles` adds `capabilitiesForClaims` +
  `grantedCapabilitiesForReq(req)` (claims → matched custom roles → their permission sets' capabilities). The AI
  surfaces (`routes/ai` + `routes/studio` `enforceOr403`) now pass `granted: grantedCapabilitiesForReq(req)`, so a
  member of a custom role whose permission set includes an AI capability gets past that capability gate even when
  it's off by default. Bounded + safe: the grant lifts ONLY the capability gate — the role/step-up gates, the AI
  kill switch, and egress/residency controls all still apply. 1 capability test (a grant lifts an off capability;
  a mismatched grant doesn't) + `capabilitiesForClaims` test; AI/capability/governance/studio route suites green;
  typecheck clean.
- **Slice 4 follow-up ✅ (swept the remaining enforcement gates).** For consistency, the other two per-request
  capability gates now pass `granted` too: `routes/mcp` (the `mcp` capability) and `routes/broker-command` (the
  `vendor:<id>` capability). Together with the `routes/ai` + `routes/studio` `enforceOr403` helper (which also
  covers STT via `sttCapabilityId`), **every capability ENFORCEMENT call site is now permission-set-aware**. Left
  untouched by design: `ai-containment`'s `effectiveState` read computes the deployment's AI exposure/containment
  posture (an org-wide security floor, independent of the caller) — not a per-principal gate. mcp + broker-command
  route suites green; typecheck clean.

### X.7 The issue grid as a JSON-defined artifact  ⬜ Todo — designed
- **Rationale.** The editable data grid (`components/grid/IssueGrid`) still hardcodes its column set
  (`GRID_COLUMNS`, availability-gated; saved-views can narrow/reorder but only over those hardcoded
  fields). Per the universal-coverage rule, the grid's **column catalogue/config should be JSON**,
  org-authorable and RBAC-gated.
- **Design (from the architecture scout).** The grid is a **distinct editable-data-grid feature** (the
  `grid` module, mounted in `pages/ProjectDetail`), *not* a `TablePanel` — TablePanel is read-only and
  lacks the inline-edit/bulk/availability/optimistic-write machinery, so it must **not** be collapsed
  into a table-panel def. The **live** JSON-config mechanism in this codebase is the **settings-bundle
  slice** pattern (`/api/dashboards`, `/api/screen-defs`, `/api/screen-layouts` — merged over built-ins),
  *not* the `/api/defs` importer store (whose `screen`/`dashboard`/`report` kinds are validated but **not
  consumed by any renderer** — a parallel, half-wired store). So the smallest correct path: a new
  **`gridColumns` settings-bundle slice** (`GET/PUT /api/grid-columns`, mirroring `lib/org-screens.ts`)
  merged over the `GRID_COLUMNS` default, keeping `visibleGridColumns` availability-gating at render.
  Saved-views (`scope:"grid"`) stay the per-user narrowing layer on top.
- **Constraint.** Stateless lens preserved: a grid-columns def lists which advertised fields to show/edit
  and in what order — never issue data; columns still intersect with backend availability; writes still go
  through the broker with the optimistic-concurrency token.

### X.8 Dashboards as JSON-defined artifacts  ✅ Already JSON-defined (finding) — unification optional
- **Finding (architecture scout).** Dashboards are **already fully JSON-defined and admin-editable** —
  `Dashboard = { id, name, widgets: DashboardWidget[], refreshMs? }` persisted via `GET/PUT /api/dashboards`
  (settings bundle), rendered by `pages/Dashboards` with full CRUD (add/remove/reorder widgets, span,
  auto-refresh, presets, import/export). The placeable widget catalogue is JSON in
  `@workspace/backend-catalogue` (`widget-catalogue`), drift-guarded against the `WIDGET_COMPONENTS` map;
  each widget's *internal* rendering is React (a `metric`-like primitive), which is correct — the
  **composition** is the JSON def. Screens can also embed any dashboard widget via `WidgetPanel`.
- **The only gap** is consistency of STORE: dashboards use the settings-bundle slice, while the `dashboard`
  kind in the `/api/defs` importer is **declared but unwired** (validated by `structural(["id"])`, rendered
  nowhere) — the same state as the `screen`/`report` def kinds. So "dashboards should be JSON-defined" is
  **already satisfied**; what's *not* done is routing them through the unified importer + scoped encrypted
  stores (the "everything through one mechanism" vision). That unification (reconciling the two stores) is a
  larger cross-cutting project — see X.10 — and is optional, not required for dashboards to be JSON-defined.

### X.10 Unify the two JSON stores (everything through the importer)  🚧 In progress (slice 1 of ~5)
- **Decision (2026-07-17).** Chosen direction: **unify on the importer** — route dashboards, screens, reports
  (and the planned grid columns) through `/api/defs` into the scoped AES-256-GCM stores (user/project/org), so
  *everything a user/admin writes to JSON flows through one validated choke point.* Today there are two stores:
  the **settings-bundle slices** (`/api/dashboards`, `/api/screen-defs`, `/api/screen-layouts`) are live and
  rendered; the **importer** (`/api/defs`) is live for `primitive`/`form` but its `screen`/`dashboard`/`report`
  kinds are **validated-but-unconsumed**. Unification makes the renderers read from the importer.
- **THE INVARIANT (user directive, 2026-07-17).** **Two write paths, period:** the **importer** (create,
  `POST /api/defs`) and the **editor** (edit, `PUT /api/defs/:id`) are the ONLY things that may persist a
  user-authored DEFINITION into the encrypted stores. **Every other surface is read-only ingest** — it *reads*
  resolved defs and renders them; it never writes. **A def in use is read-only**: a rendered dashboard / screen /
  report can only be changed by loading it into the editor, which writes back through that one path. This means
  the parallel definition-writers that exist today (the settings-bundle `PUT`s for dashboards / screen-defs /
  screen-layouts, and any theme / font / business-rule / saved-view writer) are **convergence targets to
  retire** — not just stores to overlay. Scope is **definitions** (the `DEF_KINDS`); user *content* with its own
  purpose-built validated editor (whiteboard scenes, wiki docs, proofs) is a separate category and out of scope
  here. (Overlay slices 2–4 stay valid as the additive first step; the retirement of the parallel writers is the
  cutover, slice 5+, now understood as mandatory, not optional.)
- **The scope classifier (user directive, 2026-07-17).** *"Is it a NEW ARTIFACT, or data in flight?"* A
  **definition** is authored once and then *used* read-only (a dashboard, screen, report, form, theme/colour,
  font, business rule, content page, template, workflow) → it goes through the importer/editor. **Content in
  flight** is saved continuously as you work (whiteboard sticky notes, wiki doc edits, proof annotations) — you'd
  never "export on every save" — so it keeps its own purpose-built live editor and encrypted content store. The
  rationale is cost + safety: the sealed stores are **write-rarely / read-mostly**, every write is a
  decrypt→modify→re-encrypt cycle, so funnelling all *definition* writes through the one importer choke point
  keeps those cycles rare and in one place; every other surface only ingests (reads a resolved def, renders it,
  cacheable, never re-encrypts). By this test: **saved/panel views** (live per-user render state) and the
  already-encrypted **admin/registry metadata** (def-policy, custom-roles, extension, registry-item — their own
  single validated encrypted writers, with step-up) are NOT new-artifact definitions and stay on their paths;
  the **authored artifacts** converge.
- **Audit (2026-07-17) — the parallel definition-writers to retire, in priority order.** All bypass the importer,
  persisting to the **settings/config bundle** (a different store from the sealed def store), so convergence is a
  real migration, not just a UI change. Core: `PUT /api/dashboards` (`dashboards`), `PUT /api/screen-defs`
  (`screenDefs`) + `PUT /api/screen-layouts` (`screenLayouts`), `PUT /api/reports` + `/api/reports/custom` +
  `/api/report-overrides`, `PUT /api/forms` (`forms`). Styling/rules: `PUT /api/branding` (org **colours + fonts**)
  and `PUT /api/admin/ruleset*` (**business rules**) — bespoke writers. Then org-JSON config (content pages,
  templates, workflows, automations, custom fields). **The super-writer** `PATCH /api/settings` can write any
  slice in bulk — it must be locked out of the converged slices too. Sequencing chosen: **core first, slice by
  slice** — finish each kind (author/edit → importer; render read-only; migrate existing settings data; retire
  the old writer + close the `PATCH` bypass for that slice) before the next.
- **Slicing.** (1) the resolve-by-kind read seam; (2) dashboards render importer defs (overlay, real validator);
  (3) reports; (4) screens; (5) migrate/bridge the settings slices + retire the parallel path. Each slice is
  additive (built-ins/settings keep working) until the final cutover — no big-bang.
- **Slice 1 ✅ (the resolve-by-kind read seam).** The importer's `GET /api/defs` returns metadata only; renderers
  need full payloads. Added **`GET /api/defs/resolved/:kind`** (viewer+) returning the stored defs of one kind
  **with their payloads**, aggregated across the caller's private area + the org area + the requested project
  (when in scope) — the exact scope logic as the metadata list, so no new authz surface. Two path segments, so
  it never collides with `/defs/:id`; empty when the store is off; unknown kind → 400. SPA `lib/defs` gains the
  typed **`useResolvedDefs<T>(kind, projectId?)`** hook — the seam every renderer consumes next. 1 route test
  (full payloads, kind-filtered, viewer-readable, unknown-kind 400); both packages typecheck clean. **Next:**
  slice 2 — dashboards render importer `dashboard` defs (a real dashboard validator + overlay on `Dashboards`).
- **Slice 2 ✅ (dashboards render importer defs).** `def-import` gains a **real `dashboard` validator** (id +
  name + a `widgets[]` of `{id,type}` — the actual `Dashboard` shape, unknown widget types tolerated), replacing
  the trivial `structural(["id"])`, so a stored dashboard can genuinely render. `pages/Dashboards` reads
  `useResolvedDefs<Dashboard>("dashboard")` and **overlays** the importer-authored dashboards into the picker
  under a **"Imported (read-only)"** group: they select + render like any dashboard but are **view-only** —
  edited in the definition editor, never joining the settings-bundle CRUD set (so a Save can't migrate them),
  keyed by their scoped store id and shape-guarded against a malformed payload. First renderer consuming the
  X.10 seam. 1 def-import validator test (real shape + rejections), the resolve seam test seeds a real dashboard,
  1 page test (importer dashboard renders read-only, no Edit); both packages typecheck clean.
- **Slice 3a ✅ (dashboards AUTHORED through the importer — the write-path convergence).** `pages/Dashboards`
  now writes every new/edited dashboard as a **def through the importer** (`useImportDef` `POST /api/defs` /
  `useUpdateDef` `PUT /api/defs/:id` / `useDeleteDef`), into the scoped encrypted store — with a **storage-target
  selector** (Personal / Project / Org-wide) for a new def. New, preset, and file-import all author defs; a
  def-backed dashboard is now editable in the builder (which IS the editor, writing through the one path), while
  a rendered/viewed dashboard stays read-only. The legacy settings-bundle writer (`PUT /api/dashboards`) is kept
  **only** to manage pre-existing dashboards (badged "Legacy") until they're migrated — no NEW settings writes.
  Net: the encrypted store's single decrypt→encrypt write path now covers dashboard authoring. 2 page tests
  (New authors via `POST /api/defs` with kind+storage and does NOT `PUT /api/dashboards`; a def dashboard is
  editable), existing tests repointed to the importer; SPA typecheck clean. (Operational note: authoring now
  needs the `defImporter` module + a configured artifact store; legacy dashboards still render without it.)
  **Next:** slice 3b — migrate existing settings dashboards into the def store + retire `PUT /api/dashboards`;
  then slice 4 (reports), slice 5 (screens), and the `PATCH /api/settings` lockdown.
- **Slice 3b ✅ (drain the legacy dashboards into the def store).** `pages/Dashboards` gains an **admin-only**
  "Migrate N legacy → definitions" action: it re-authors every legacy settings-bundle dashboard as an **org def**
  through the importer (`mutateAsync` loop), then **clears the settings slice** (`PUT /api/dashboards []`) — after
  which the parallel store holds nothing and the only dashboard writer left in normal use is the importer/editor.
  Admin-gated (an org def write needs manager+, and it touches the shared slice). 2 tests (admin migrate →
  `POST /api/defs` org + settings cleared to `[]`; non-admin sees no migrate button); SPA typecheck clean.
  **Next:** slice 3c — once drained, remove/har­den the `PUT /api/dashboards` route itself; then slice 4
  (reports), slice 5 (screens), colours/fonts + business rules, and the `PATCH /api/settings` lockdown.
- **Slice 3c ✅ (retire the legacy dashboards writer).** `routes/dashboards` is no longer the generic settings
  collection: it's now **read-only plus a single permitted write** — draining the slice to `[]` (the migration).
  A `PUT /api/dashboards` carrying real dashboards is a **retired bypass → 410**, pointing the caller at the
  importer; a non-array is likewise 410. So the parallel dashboard writer can never re-open. **Dashboards are now
  fully converged** — authored/edited only through the importer/editor into the encrypted def store, drained out
  of the settings bundle, and the old route hardened shut. 5 route tests (read; 410 on a real write + nothing
  persisted; empty-drain accepted; non-array 410; pmo gate); features/integration suites green; typecheck clean.
  **Next:** slice 4 (reports), slice 5 (screens), colours/fonts + business rules, then the `PATCH /api/settings`
  lockdown so the super-writer can't reach a converged slice.

### X.11 Importer/editor access model — everyone, RBAC-scoped; shipped defs read-only  🚧 In progress
- **Directive (2026-07-17).** (1) The importer AND editor are for **every author** — access to each *store* is
  RBAC-scoped by the def-policy (own private area for any contributor; project = manager; org = pmo/admin), not
  an admin-only surface. (2) **Shipped/pre-built defs are read-only**; any edit must be **saved under a new name
  into a CUSTOMER store** (user/project/org) — never a system store.
- **Slice 1 ✅ (open the surface + scope the pickers).** The `/definitions` importer/editor nav entry moved from
  the **admin shelf (pmo/admin only)** to **primary, visible to contributor+** — so a regular author can reach it
  and save to their private area (the page + route were never role-gated; only the nav hid it). `lib/def-policy`
  gains `canWriteDefScope` / `writableDefScopes` (mirrors the server gate); the **storage-target pickers** in the
  Definitions importer and the Dashboards builder now offer **only the scopes the caller can actually write** (a
  contributor sees just "My private area"), with the server staying authoritative. **Shipped-def read-only is a
  structural guarantee:** the importer only ever writes the customer scopes `user`/`project`/`org` — there is **no
  system storage target** (`system`/`builtin`/`shipped`/`sidecar` are all rejected 400), so a pre-built def can
  never be overwritten; customising one is necessarily a new def in a customer store (the same copy-on-fork the
  dashboard presets already use). Tests: contributor sees only the private-area target; nav drift guards updated
  (definitions now primary); the importer rejects every non-customer storage target. Both packages typecheck
  clean. **Next:** an explicit "Duplicate to my store" affordance wherever a built-in/shipped def is surfaced for
  editing (make the copy-on-fork a one-click action, not just an implicit re-author).
- **Correction + Slice 2 ✅ (the SYSTEM store is a real encrypted blob of shipped defaults).** Clarified: "system
  storage" is not code constants — it's **another encrypted JSON blob** (same sealing as the customer stores)
  holding all OUR shipped defaults (default screens / reports / rulesets / dashboards / …), **read-only to users**.
  Modelled it as a new **`system` `ArtifactScope`** (one sealed `system.json` per type) that is deliberately **NOT
  a `StorageTarget`** — so the importer/editor can never write it; only the product's own seeder can. `def-import`
  adds `makeSystemDefId` (`system~<localId>`), `listSystemDefs`, and the privileged **`seedSystemDef`** (validates
  by kind, then seals into the system blob, `createdBy:"system"`). The **resolve-by-kind seam now returns the
  system defaults** (read-only `system~…` ids) beneath the caller's own defs, so every renderer gets
  *defaults ∪ customer overrides* from one read. The user importer still rejects a `system` write target (400), so
  a shipped def can never be overwritten — customising forks to a customer store. 1 route test (a seeded system
  default is surfaced via resolve with `createdBy:"system"`; the importer refuses to write `system`); artifact-store
  scope handling extended (`system.json` read/write + filename round-trip); both packages typecheck clean. **Next:**
  seed the actual shipped catalogues (screens/reports/rulesets/dashboards) into the system store, and the client
  "Duplicate to my store" fork for a read-only `system~` def.
- **Slice 3 ✅ (seed the shipped catalogues into the system store).** `lib/system-defs` builds the full
  shipped-default set from OUR bundled catalogues in `@workspace/backend-catalogue` (the approved-from-us source):
  **reports** (`reportCatalogue`), **forms** (`formCatalogue`), **business rules** (`referenceRulesetCatalogue` —
  the methodology reference bundles), and **dashboards** (`dashboardPresetCatalogue`, adapted to the real
  `Dashboard` shape by synthesising each widget's `id`). It seals them via **`replaceSystemDefs`** — a new
  **one-shot** `artifact-store.replaceArtifacts` (single decrypt→replace→re-encrypt, never per-item). Wired into
  `bootstrap()` as **`seedSystemDefaultsIfEmpty()`**: auto-installs on first boot only (empty store); it does NOT
  silently overwrite on every boot. (Screens + primitives still to come — their defaults live only in the SPA and
  must be relocated into the shared package first.) 1 seeder test (installs report/form/businessRule/dashboard
  system rows, `createdBy:"system"`, preset widgets get ids; idempotent install; one-shot re-apply is stable).
- **Slice 4 ✅ (the admin-gated approved-update mechanism).** Per the directive — the system store's decrypt-update-
  re-encrypt must be **admin-gated and only accept approved-from-us content**. `routes/system-defs`:
  **`POST /api/admin/system-defs/apply`** (admin + **step-up**, audited) re-applies OUR bundled catalogue in one
  shot — it takes **no def payload**, so an admin can only apply the vendor-approved defaults, never inject their
  own into the system tier; **`GET /api/admin/system-defs`** is an admin read of the installed set (count per
  kind). There remains **no importer/editor write path** to `system`. 3 route tests (admin applies + summary;
  non-admin 403 on both; stale step-up refused). Both packages typecheck clean.
- **Slice 5 ✅ (methodologies are system JSON + org-authorable).** Added **`methodology`** as a `DefKind`
  (backend `def-import` + SPA `defs` + the `Definitions` editor's `KIND_LABEL`), validated structurally (`id` +
  `label`). The seeder now installs the shipped **methodology catalogue** (`methodologyCatalogue()` from the
  bundled package — the rich `MethodologyDefinition`: kind, capabilities, tools, …) into the read-only system
  store alongside reports/forms/rules/dashboards. Because `methodology` is now a real def kind, it is
  **authorable through the importer into the org-wide store** (and user/project) under the same def-policy
  (org = pmo/admin) — no special-casing. `DEF_KINDS` drift test + methodology validator test updated; seeder test
  asserts a methodology default is installed; both packages typecheck clean. **Next:** relocate the SPA-only
  **screen** (24 panel-bearing) + **primitive** (19) default catalogues into `@workspace/backend-catalogue` so the
  backend seeder can source them too (they're already `DefKind`s + org-authorable — only the *system defaults*
  are blocked on the data living SPA-side); then the client "Duplicate to my store" fork.

### X.12 Def selection + lock (which def is IN USE at each scope)  🚧 In progress (slice 1 of ~4)
- **Goal (user directive, 2026-07-17).** The tiered def store says which defs EXIST; it does not say which is
  IN USE. Two needs: (a) a **project manager can load THEIR custom screen** instead of our default (select a def
  for their scope); (b) an **admin/PMO can LOCK a choice** at a higher scope so lower scopes can't override
  ("the org mandates this methodology / these screens").
- **Finding (architecture scout).** No selection infra exists at the right level yet: screens resolve only
  built-in-vs-**org** (org wins; no project/user tier, no lock); methodology has no per-project selection; the
  `/api/defs/resolved` seam is **flat** (all tiers returned as distinct scoped ids, no winner picking, no
  "active" field). The closest existing LOCK pattern is `feature-resolution.ts` (org→programme→project monotonic
  narrowing → `{locked, lockedBy}`, already governing `methodology:<id>`) — but it locks on/off, not a chosen
  value. So a small **binding layer** is needed, reusing those lock semantics; the def store stays pure content.
- **Design.** A **selection binding** = for a logical SLOT (a screen id, a methodology slot, …) which def is
  chosen at each scope + whether it's LOCKED. Resolution mirrors feature-resolution: an ORG lock wins absolutely;
  else a PROJECT lock wins for that project; else most-specific-unlocked wins (user → project → org); else the
  system default. The binding decides the WINNER; the def store still serves content by id.
- **Slices.** (1) the pure resolver; (2) a `defBindings` settings slice + read/write routes (RBAC: user sets
  their own, project = manager, org = pmo/admin; setting `locked` needs the scope's authority); (3) wire the
  render seam (`useScreenDef` / the resolve consumer) to pick the winning def per scope; (4) the select/lock UI.
- **Slice 1 ✅ (the pure resolver).** `lib/def-binding`: `DefBinding {defId, locked?}`, `DefBindingConfig`
  (`org` slot→binding, `project` projectId→slot→binding, `user` sub→slot→binding), `resolveDefBinding(config,
  slot, ctx)` → `{defId|null, locked, lockedBy?, source}` with the narrowing + lock rules above, and `canRebind`
  (may a principal at this level change the slot — a user is blocked by any lock, a project only by an org lock).
  5 tests (default fallback; user>project>org; org lock absolute; project lock pins users but org can still
  override; per-slot isolation); typecheck clean. **Next:** slice 2 — the `defBindings` store + routes.

### X.9 Library audit — permissive (MIT/BSD/Apache-2.0) code that clears our five gates
- **The gate (standing rule).** Add third-party code only where it (1) doesn't break our rules
  (stateless / broker-mediated / zero-at-rest), (2) is license-safe (MIT/BSD/Apache-2.0 — no
  MPL/EPL/GPL, no paid tiers), (3) is auditable, (4) is secure (no new attack surface; ideally less),
  and (5) genuinely enhances what we have **or** is more secure/safe. Duplicating working hand-rolled
  code fails gate 5 unless it's demonstrably safer.
- **Audit verdict (2026-07-17).** A codebase audit checked the tempting candidates against real code:
  - **DOMPurify (Apache-2.0)** — **SKIP.** No raw-HTML sink exists. The shipped SPA has zero
    `dangerouslySetInnerHTML`/`innerHTML`; wiki renders structured `DocBlock[]` as escaped React text
    nodes, embed/proof URLs are scheme-allowlisted server-side (`wiki-doc.sanitizeEmbedUrl`,
    `proof.SAFE_URL_SCHEMES`), whiteboard SVG is clone-and-serialize *export only* (no import sink).
    Nothing to sanitize — it would be dead weight, not safety.
  - **rrule (BSD-3)** — **SKIP for now.** Recurrence is hand-rolled in `recurrence.ts` (~95 lines,
    tested), covering `daily/weekly/monthly/yearly`, `every N unit`, weekdays, `FREQ=…;INTERVAL=…`, with
    the fragile cases handled (UTC-midnight to dodge DST, month-end clamping, leap year). rrule only
    wins if we need full RRULE (BYDAY lists, COUNT, UNTIL, nth-weekday) — no feature needs that yet.
  - **@tanstack/react-virtual / react-table (MIT)** — **SKIP the dep; extended our own.** We already
    have a tested, dependency-free `useVirtualRows`; applied it to the issue grid + governance audit
    trail (2026-07-17) instead of importing a windowing lib.
  - **React Flow (`@xyflow/react`, MIT)** — **DEFER (genuine future fit).** The natural renderer for
    the `diagram` native-handoff kind + a future automation-recipe editor (1.2). Adopt when that surface
    is built, not before.
  - Already in-tree and leaned on rather than re-added: **`zod`** (v4, validation), **`yjs`** (CRDT
    co-edit), **`re2js`** (linear-time regex / ReDoS-safe), **`jose`/`openid-client`** (OIDC).
- **Excluded on license/cost (do not adopt):** BlockNote (MPL), elkjs (EPL), tldraw (non-MIT terms),
  Bryntum/DHTMLX/Highcharts/AG-Grid/Handsontable (commercial), and the paid-tier traps where the free
  tier is bait — MUI X Pro/Premium, Tiptap Pro, Schedule-X premium, SheetJS Pro, FullCalendar
  resource/timeline plugins. If a permissive need arises: `papaparse` (CSV), `fuse.js`/`minisearch`
  (client search), `graphology` (graph algos), `@dnd-kit` (kanban DnD), `visx` (charts) — all MIT,
  evaluated per the five gates at adoption time.

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
- _2026-07-16_ — Phase 2.3 slice 3e (multi-user live cursors) shipped, **completing 2.3**: cursor presence on
  a board over the shared in-memory relay (`lib/collab-hub`) on a `board:<id>` room, added to the whiteboard
  feature module itself (SSE stream + broadcast) so it's decoupled from the wiki co-edit flag. Transient
  (nothing stored); throttled position from the client, identity (label + colour) stamped server-side (no
  spoofing); short TTL fades a silent leave; project-board rooms are `guardProjectScope`-checked. viewer+,
  gated on the existing `presence` toggle, degrades to a no-op without `EventSource`. **2.3 (whiteboards) is
  now complete** — native canvas, storage targets, export, sticky→item, live cursors.
- _2026-07-16_ — Phase 2.4 slice 1 (proofing foundation) shipped: a proof is a JSON definition built of a new
  `annotation` primitive family (pin/box/highlight, on the `proof` surface) that REFERENCES an image/PDF
  deliverable (never inlined — zero-at-rest) and carries a review decision bound to a version. Saved to a
  storage target (private/project/org encrypted-JSON, sealed) via the shared scoped-id + authz primitives; no
  sidecar. Behind a default-off `proofing` module: `/api/proofs/*` CRUD + `POST /proofs/:id/decision`
  (server-stamped, version-bound; a new deliverable re-opens it). One sanitiser choke point (safe-scheme url,
  0..1 coord clamp, per-type allow-list). Client hooks + drift-guard/catalogue/sanitiser/route tests. Next:
  the annotation UI + threaded review + approval-chain binding.
- _2026-07-16_ — Phase 2.4 slice 2 (annotation UI) shipped: a `/proofs` page + an `AnnotationOverlay` that
  renders the deliverable (image inline / PDF via `<object>`) and overlays pin/box/highlight annotations at
  normalised coords (place on click, drag to move, inspector edits note + resolved + delete). The page browses
  proofs with a decision badge, a create form (name + url + kind + storage), Save/Delete, and a review
  decision bar (Approve / Request changes / Reject → the server-stamped version-bound decision route).
  contributor+ authoring (viewer read-only); org proofs manager+. Nav (feature-gated) + route + e2e + i18n;
  pure `lib/proof-geometry` + overlay + page tests. Next: threaded review + approval-chain binding.
- _2026-07-16_ — Phase 2.4 slice 3 (threaded review) shipped: a comment thread per annotation, reusing the
  existing comments seam with NO backend change — the overlay lifts its selection (onSelect) and the page
  renders a CommentsPanel keyed by the `proof:<id>#<annotationId>` room (general discussion under `proof:<id>`
  when nothing is selected). Gated on the `comments` module; same org-content room posture as wiki doc
  comments. Overlay onSelect + thread-switch tests. Next: approval-chain + passkey binding of the decision.
- _2026-07-16_ — Phase 2.4 slice 4 (approval-chain + passkey binding) shipped, **completing 2.4**: a proof
  approve/reject decision, when an admin binds `proof.decision` to a chain, is HELD (202) and only stamped
  after a different approver signs it off with a passkey over the proposal's content hash — the workflow-run
  pattern via `proposeIfBound` + a registered executor (`lib/proof-approval.ts`). Version-snapshotted so a
  stale sign-off can't land on newer artwork; separation-of-duties enforced by the engine. Unbound ⇒ direct
  (default). Executor unit tests + a full end-to-end passkey round-trip route test + SoD refusal. **2.4
  (proofing) is complete.**
- _2026-07-16_ — Phase 2.5 slice 1 (offline detection + install-prompt UX) shipped: `lib/connectivity`
  (`useOnline` + a pure `connectivityState` distinguishing offline / unreachable / connected — the header now
  reflects all three) and `lib/use-install-prompt` (capture `beforeinstallprompt` → our own Install button,
  replay-once, clears on `appinstalled`). i18n `header.install`. Client-only, no zero-at-rest impact. The
  offline DATA cache (encrypted + ephemeral + opt-in per the golden-rule decision) is slice 2; push slice 3.
- _2026-07-16_ — Phase 2.5 slice 2 (encrypted offline data cache) shipped: `lib/offline-cache` caches ONLY
  the my-work/tasks read models on-device, AES-256-GCM'd under a non-extractable, session-`sub`-scoped
  WebCrypto key in IndexedDB (wipes + re-mints for a different user), TTL'd (24h), wiped on logout + toggle-
  off. `lib/use-offline-cache` — off-by-default per-user toggle behind a new `offlineCache` module + hydrate-
  on-open + allow-listed write-back subscriber; an Offline-access settings card. Zero-at-rest preserved
  (encrypted, narrow, ephemeral). Crypto/allow-list/TTL/guarded-no-op + toggle/settings tests. Next: push.
- _2026-07-16_ — Phase 2.5 slice 3 (browser Web Push) shipped: the `web-push` dep adds a push channel that
  reaches a closed PWA, riding the existing notify bus. Server — `lib/web-push` (VAPID config gate: inert
  without keys; endpoint egress allow-list bounds SSRF to known push services), `lib/push-subscriptions`
  (per-user AES-256-GCM-sealed device subscriptions — endpoint URL is zero-at-rest), `lib/push-delivery` (bus
  effect fired ONCE on the origin replica; personal-only; prunes gone subs), `routes/push` behind a default-
  off `pushNotifications` module. Client — `sw.js` `push`/`notificationclick` handlers, `lib/web-push-client`
  (feature-detect + PushManager subscribe), `lib/use-push` + a per-device Notifications settings card (off by
  default, dropped on logout). Zero-at-rest preserved. Allow-list/classify/config-gate/sealed round-trip/
  delivery-prune/route + client-probe tests. **Phase 2.5 slices 1–3 done; native shells backlogged (stretch).**
- _2026-07-17_ — **Virtualization extended to two high-cardinality surfaces** (no new dependency —
  the audit found a working, license-free, tested hand-rolled `useVirtualRows` already in-tree, only
  wired into ListView/TablePanel). Applied it to the **editable issue grid** (`components/grid/IssueGrid`
  — bounded scroll body + sticky header, windowed `<tr data-vrow>` with spacer rows) and the **governance
  activity/audit trail** (`components/settings/GovernanceDashboard` — the `activity-log` `<ul>` windowed
  in its fixed-height box). Both fall back to rendering every row when unmeasured (tests) or short, so
  behaviour is unchanged for small sets. Dependency review verdict (rule: license-safe + auditable +
  secure + genuine enhancement): **skip DOMPurify** (no raw-HTML sink — the SPA renders user content as
  React text nodes, URLs scheme-allowlisted server-side), **skip rrule** (the hand-rolled `recurrence.ts`
  already covers the current grammar incl. DST/month-end), **skip @tanstack/react-virtual/table** (we
  extended our own hook instead). Grid + governance tests gained a `data-vrow` wiring assertion; SPA
  typecheck clean.
- _2026-07-17_ — **X.1 native-handoff slice 2 (sandboxed Live-Embed preview)** shipped: `buildEmbedUrl`
  (host-allowlisted, off-host rejected), `DemoBroker` returns `embedUrl` on the `embed` action, `<UseNative>`
  previews it in a sandboxed `<iframe>`; CSP gains a strict `frame-src 'none'` default + operator `CSP_FRAME_SRC`
  allowlist (replaces 'none'). Roadmap: added the **MIT/permissive library-audit verdict** (X.9) and the
  **architecture findings** — grid to JSON-define via a `gridColumns` settings slice (X.7), **dashboards already
  JSON-defined** via `/api/dashboards` (X.8), and the two-store unification as an open decision (X.10).
