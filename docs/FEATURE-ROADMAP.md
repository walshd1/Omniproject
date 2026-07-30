# Feature Roadmap — competitive gap backlog

> 📦 **Delivered items** have moved to [FEATURE-ROADMAP-DELIVERED](archive/FEATURE-ROADMAP-DELIVERED.md). This roadmap now tracks only 🚧 in-progress and not-yet-built work.


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
(42 connectors), not a Jira/Asana clone. It already meets or beats the field on:

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
- **Slice 3 shipped (live trigger binding) ✅.** Recipes fire automatically: **event** triggers via the
  domain-event dispatcher (`startRulesDispatcher`, wired at boot), **schedule** triggers via one cron
  `ScheduledJob` per recipe on the unified job scheduler (`recipeScheduledJobs`), both reading the
  `automations` collection and running through the same grant-gated path as the manual run — all behind
  `RULES_ENGINE_EVENTS` (off by default). Hardening pass verified **emit coverage** and fixed a real gap: the
  `wiki_doc` entity emitted under `wiki_doc` while the advertised trigger surface is `wiki-doc`, so
  *"When a wiki document is …"* recipes silently never fired — closed with an `eventSurface` override on the
  entity descriptor, plus an exhaustive coverage test (`automation-live-triggers.test.ts`) that flags any
  advertised `RULE_SURFACES` key with no emitting write path. Live-emitting surfaces today: `issue`, `task`,
  `wiki-doc`; `risk`/`project`/`timesheet` remain advertised-but-observe-only until a write path emits them.
  The manual `POST /automations/:id/run` still holds mutating recipes at `202` (no grant); the automatic
  paths run them grant-gated. See `docs/design/SEMANTIC-RULES-ENGINE.md` → "Live-trigger status & emit coverage".
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

### X.13 `programmeManager` RBAC role — scoped rung, step-up to lock  🚧 In progress
- **Directive (2026-07-17).** A **programme manager** is a permission level in RBAC, assignable by admin/PMO —
  a manager whose reach is a whole programme (its projects), sitting above project `manager` and below PMO.
  Chosen posture (user): a **scoped rung, no hardware key for everyday work; a programme-level LOCK needs a
  step-up**.
- **Slice 1 ✅ (the role).** Added **`programmeManager`** to `ROLES` at **base rank 4** (above `manager`, below
  the authorities); `BASE_RANK`, `ENV_KEY` (`OIDC_PROGRAMME_MANAGER_ROLES`), and the claim ladder all include
  it. The **authorities (pmo/admin) now imply `programmeManager` base** (they sit above it), computed as the
  **higher** of the linear rung and the authority-implied rung — so a `[manager + pmo]` claim still clears a
  `programmeManager` gate; demo holds it. `grantsForRole` + `scope.resolveScope` updated: a `programmeManager`
  resolves to **programme scope** (their programmes, from the group claims), so the tier gate + the row-level
  scope together bound them to their programmes. It's **assignable via the existing role-map** (it's one of the
  fixed `ROLES`, so `getRoleMap`/`setRoleMap` include it — no new mechanism; the SPA `Role`/`roleAtLeast` mirror
  updated). 1 new test (programmeManager clears manager/programmeManager, not pmo/admin; a plain manager doesn't
  clear it; pmo/admin sit above it); the 5 RBAC assertions encoding the old "authorities imply manager base"
  invariant updated; full RBAC suite (gateway 120 + properties + sso-parity + scope + strong-auth + custom-roles
  + route gating = ~200 tests) green; both packages typecheck clean.
- **Slice 2 ✅ (programme-scope binding writes + step-up-to-lock).** Done under X.12 slice 2c: the def-bindings
  route accepts `programme` scope (programmeManager rung + that programme's row-scope, pmo/admin above), and
  setting any LOCK now requires a fresh step-up (`stepUpFresh` on the sealed session's `stepUpAt`). See X.12 2c
  for the route/test detail.
- **Slice 3 ✅ (programme as a def WRITE target).** Done under X.12 slice 2d: `programme` is now a writable def
  target through the one importer/editor, gated by the `programmeManager` def-policy scope + that programme's
  row-scope (`guardProgrammeScope`), without widening the shared `StorageTarget`. See X.12 2d. **Next:** X.12
  slice 3 (wire the render seam to the winning def per scope) + slice 4 (select/lock UI); the SPA def-policy
  mirror (`writableDefScopes`) can surface `programme` as an authoring target for a programmeManager.

### X.14 Def-store export / backup + full-instance migration  🚧 In progress
- **Directive (2026-07-17).** Two goals: (a) an admin can safely take **all their settings AND defs** to back
  them up or move to a new instance; (b) we can **replace the code entirely on GitHub** and the org can then
  **reimport their data** — with security maintained throughout.
- **Finding — the gap.** The portable snapshot (`config-snapshot`) captured a curated **settings subset only**;
  it never included the **encrypted def stores** (imported defs, selection bindings + locks, the def-write
  policy, custom RBAC roles). An admin backing up today silently lost every def, binding, and lock.
- **Slice 1 ✅ (def-store export/import lib + routes).** `lib/def-store-export`: `buildDefStoreExport(now)`
  walks the customer-authored artifact types (`def`, `def-binding`, `def-policy`, `custom-roles`, and — since
  the X.10 user-prefs move — `user-prefs`) via
  `listAllArtifactCollections`, **excluding the system scope** (our catalogues re-seed from code, so they never
  travel in a customer backup), into a portable plaintext bundle. `applyDefStoreExport(bundle)` is the ONLY
  writer back in (the X.10 choke-point rule): it **re-validates every def by its per-kind validator** (a
  tampered/injected payload is dropped, not written), **refuses the read-only system scope**, requires config
  blobs to be `{id}` objects, and **re-encrypts each collection under the TARGET instance's own key** via
  `replaceArtifacts`. **Security end-to-end:** the encryption KEY never leaves — export is decrypted plaintext
  the operator secures, import re-seals under the new instance's key; both routes are **admin + a fresh
  step-up + audited** (`GET/POST /api/setup/defs-export|defs-import`, alongside the settings snapshot/restore).
  So a bundle survives a full code replacement + redeploy and reimports cleanly. 5 lib tests (capture excludes
  system; wipe→reimport round-trip = migration; system scope refused; invalid def dropped; foreign schema
  rejected) + 3 route tests (export needs admin+step-up; export→reimport round-trip; import gate + schema
  reject). API typecheck clean; setup + snapshot + def suites 43/43 green.
- **Slice 2 ✅ (the SPA Backup panel).** The setup wizard's Backup & restore step (`BackupStep`) gains a
  **Definitions backup** section beside the settings snapshot: **Download defs backup** (`downloadDefsExport`)
  and **Restore defs from file** (schema-checked upload → confirm dialog → `importDefsBundle`). A 403
  `step_up_required` from either route is surfaced as a "re-authenticate (step-up)" hint rather than swallowed;
  the upload is `safeParseJson`-hardened + schema-validated client-side before it can reach the gateway; and the
  panel states plainly that shipped system defs are never exported (they re-seed from code). 5 new component
  tests (actions render; valid def-store file opens the confirm dialog; wrong schema rejected; confirm POSTs
  `defs-import`; a step-up 403 downloads nothing). Both packages typecheck clean; BackupStep 19/19 green.
- **Slice 3 ✅ (the combined FULL backup — one file, settings + defs).** `lib/full-backup`: `buildFullBackup`
  composes the settings snapshot + def-store export under one `omniproject/full-backup` envelope;
  `splitFullBackup` validates the envelope and hands each half back to its own validator on restore.
  `GET /api/setup/full-backup` + `POST /api/setup/full-restore` (admin + fresh step-up, audited) — restore is
  best-effort per half (a settings-only or defs-only bundle still applies what it has), the def half runs the
  full re-validate + re-encrypt path, and nothing is applied on a wrong schema. SPA: a **Full backup (settings +
  defs)** section in `BackupStep` — one **Download full backup** + **Restore full backup** pair — is the
  primary "move the whole org to a new instance" action (`downloadFullBackup`/`restoreFullBackup`, same step-up
  handling). 3 lib + 2 route (full round-trip; schema+step-up gate) + 3 component tests. Both packages typecheck
  clean; export routes 5/5, full-backup lib 3/3, BackupStep 22/22.
- **✅ Requirement met (2026-07-17 directive).** Both goals are now delivered end to end: (1) an admin can take
  **all their settings AND defs** in one file to back up or move to a new instance; (2) after a **full code
  replacement + redeploy** the org reimports from that file — **security maintained throughout** (no key or
  secret travels; import is admin + step-up + audited, re-validates every def, refuses the system scope, and
  re-encrypts under the new instance's own key).
- **Slice 4 ✅ (settings-snapshot COMPLETENESS — "keep your JSON safe, that's your total config").** The
  snapshot inverted from a hand-maintained **17-key allow-list** (which silently lost priority weights,
  scheduling, skills, field routing, currency, automations, templates, governance/approval config, the
  RACI/stakeholder/allocation/budget registers …) to **every classified settings key minus an explicit
  secret-bearing deny-list** (`config-snapshot`: `ALL_SETTINGS_KEYS` = the whole `SettingsState` key set,
  `SNAPSHOT_KEYS` = that minus `EXCLUDED_KEYS`). A **drift guard** asserts `captured ∪ excluded == every
  settings key`, so a new knob travels by default and can never be silently dropped. The **config-purity guard**
  was scoped to **brokered SoR data only** (it skips the app-authored register/policy subtrees whose field
  names collide with entity words), so the in-app registers travel as part of the org's state per the directive
  ("include register content").
- **Slice 5 ✅ (ENCRYPTED complete-state backup — "secrets can travel because the backup is encrypted; keep the
  encrypted JSON + your keys = the whole system").** `GET /api/setup/full-backup?encrypted=1` builds the
  **COMPLETE** backup (every setting **including secrets** + the whole def store) and **seals it under THIS
  deployment's own config key** (AES-256-GCM via `config-crypto.sealConfig`) — `lib/full-backup`
  `buildSealedFullBackup` → `{schema:"omniproject/full-backup-sealed", keyFingerprint, sealed}`. Only ciphertext
  leaves; the key never does. `POST /api/setup/full-restore` **auto-detects** the sealed envelope, decrypts it
  with this instance's key (`openSealedFullBackup`; a wrong/rotated key → a clear 400, never a silent wipe), and
  applies the settings half with `allowSecrets:true` — legitimate because the **AES-GCM tag has authenticated**
  the bundle came from this deployment's own key. The **plaintext** full backup stays secret-free (safe as clear
  text). The user's chosen key model ("Deployment's own key"): restoring elsewhere needs the same key material
  (`SESSION_SECRET`/`CONFIG_KEY_RAW`/KMS) — the "private keys" the operator keeps. SPA `BackupStep` gains a
  **Download encrypted backup** button beside the plaintext one; restore accepts both schemas. Tests: full-backup
  lib 5/5 (plaintext withholds secrets, sealed carries + round-trips them, tamper/​non-sealed rejected),
  export routes 7/7 (sealed export gate + ciphertext + decrypt-restore + wrong-key 400), config-snapshot 3/3
  (drift guard, secret never restored from plaintext), config-purity green, BackupStep 24/24. Both packages
  typecheck clean.
- **Slice 6 ✅ (TOTAL config — every config store outside `SettingsState` now travels too).** A coverage audit
  ("verify the whole settings surface is covered") proved `SettingsState` is 100% captured (65/65 live keys, via
  a runtime check + the `security-settings` drift guard tying `CLASSIFIED_KEYS` to the live object), then swept
  every OTHER sealed store. Four held adjustable config outside settings; per the directive ("yes, as JSON
  files") all now ride the backup:
  - **`extension` + `registry-item`** (org-wide plugin/registry config, pure-JSON, no secrets) → added to the
    def-store export's `EXPORT_TYPES`, so they travel in BOTH plaintext and sealed backups. Import RE-VALIDATES:
    `isImportableExtension` re-runs `sanitizeContribution` on every contribution, `isImportableRegistryItem`
    checks kind + JSON payload — a tampered/injected row is dropped, not written (new `CONFIG_VALIDATORS` map in
    def-store-export).
  - **`ai-providers`** (provider entities + capability mapping; API keys stay in the vault) and **`rate-card`**
    (rate card + hashed identity map + project types + uplift + cost rules) → a new `stores` section on the full
    backup, carried **ONLY in the ENCRYPTED (sealed) backup** because both touch sensitive/egress surfaces (pay
    data, provider endpoints). `exportAiProviders`/`importAiProviders` re-validate each provider (id + known kind)
    and mapping entry (drops forbidden/unknown ids); `exportRateCard`/`importRateCard` round-trip the whole sealed
    state through the store's own on-disk coercion + the one `persist` choke point (so a restore is undoable).
  - **`audit-chain`** (the tamper-evident chain HEAD `{seq, lastHash}`) → sealed `stores` section, sealed-only.
    Carrying the head lets a migrated instance CONTINUE the same chain (same key material ⇒ the seals still
    verify across the boundary) instead of resetting to genesis. Restore is **ADVANCE-ONLY**: it never REWINDS
    the audit position (that would let issued seqs be reused / the chain fork) — a fresh target advances to the
    backup's head; restoring an older backup onto a live instance keeps the live (higher) head.
  - **audit EVIDENCE log** (directive: "loss/transfer must not lose the chain of evidence"). The head alone
    proves continuity but carries no evidence, and audit events streamed only to the external SIEM. So — the
    user chose it — the sealed EVENTS are now retained AT REST too: an AES-256-GCM `SealedFile` in `audit-chain`
    (RAM-only without a config dir, same posture as every sealed store), bounded by `historyRetention.retentionDays`
    (+ a hard count cap), debounced writes, flushed on backup-export and graceful shutdown. Carried in the
    ENCRYPTED backup, so encrypted-backup + keys reconstitute the whole chain AND its events, no SIEM required.
    Restore RE-VERIFIES the chain (`verifyAuditChain`) — a tampered log is refused, never written — and is
    ADVANCE-ONLY (keeps the live evidence if it's newer), moving the head to the restored tip. **DSAR made
    honest:** `dsar` no longer claims audit is "not retained in the gateway" — it reports the sealed local log,
    a content-free count of retained events naming the subject, the retention window, and the erasure-exempt /
    legal-hold basis for audit records.
  - **Retention/disposal SURFACED (admin control).** `auditLogStatus()` (retained count, window, span, durable
    vs RAM-only, cap) + `disposeAuditLog()` (prune-to-window now) power `GET /api/security/audit/log` +
    `POST /api/security/audit/log/dispose` (admin + step-up + audited), and the same active disposal is folded
    into `POST /history/dispose` so ONE run enforces both retention windows (now runs even with no brokered
    history source). SPA: an **Audit evidence log** card in the Security admin (`SecurityKeys`) shows the status
    (sealed-at-rest vs in-memory badge) + a step-up-gated **Dispose now**. Tests: security routes +2, history
    routes green, SecurityKeys 13/13. Both packages typecheck clean.
  - Deliberately still OUT (data/secrets/runtime-state, not config): `vault-store` (secrets, may be external),
    `security-state` (revocations/kill-switch), `scim` (IdP-driven), wiki/proof content (systems of record),
    `push-subscription` (per-device). Tests: def-store-export 7/7 (+ extension/registry ride + tamper-drop),
    full-backup 7/7 (+ ai-providers/rate-card sealed-only round-trip + audit-chain advance-only), store + route
    + guardrail suites green. Both packages typecheck clean.

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

## Phase 4 — SOTA competitive-parity backlog (SAP + PPM leaders, 2026 research)

Captured in full per the directive "add all missing features even if we don't think we should." Sourced
from the cited deep-research pass (SAP S/4HANA PPM, ServiceNow SPM, Planview, Broadcom Clarity, Atlassian
Align/Focus, Microsoft Planner/Project) plus general SOTA PPM. **Inclusion here is NOT a commitment** — many
items conflict with our stateless / zero-at-rest / broker-mediated rules and are logged so the trade-off is
explicit, not forgotten. Every item is ⬜ Todo unless noted.

**Disposition legend (orthogonal to build-status):**
- ✳ **Fits** — rides the existing architecture (engine + JSON artifacts + broker seam); build when prioritised.
- 🔌 **Broker-dependent** — feasible only by brokering from a connected system of record; we render/orchestrate, we don't store.
- ⚠ **Tension** — pulls against a core rule (zero-at-rest, no data cached in config, stateless); needs an explicit exception or a sidecar SoR.
- ❄ **Likely won't build** — contradicts the architecture or the positioning; logged for completeness, not planned.

> **PROGRAM IN FLIGHT — domain primitive spine (the finance pattern, applied to PM / programme / resource / forecasting).** 🚧
> A 2026-07 four-domain survey found the same shape everywhere: a rich SURFACE (fields, reports, consolidations,
> methodologies) on a THIN primitive spine — the opposite of finance, which was built out to 22 governed record
> types + pure compute engines + ruleset governance. This program applies that finance playbook to the four PPM
> domains, **foundations-first, one PR per slice**, following the golden rules (agnostic broker seam,
> fields-as-primitives, functional-core compute with tests, ruleset governance, write-lane coverage). It is the
> vehicle that completes many of the 4.x items below — cross-references noted per wave.
> - **Wave 0 — compute quick win.** ✅ **EVM engine** (`lib/backend-catalogue/src/evm.ts`, PR #874) — see 4.7.
> - **Wave 1 — foundational primitives.** ✅ typed cross-project **`dependency`** (FS/SS/FF/SF + lag → 4.10, 4.3, #876) ·
>   cost+schedule **`baseline`** snapshot (→ 4.7, #877) · **`resource`/`assignment`/`timesheet`** record types + a
>   `resource` field cluster (→ 4.2, #878).
> - **Wave 2 — compute engines.** ✅ promoted **critical-path** (#879) + **Monte-Carlo** (#880) into the catalogue
>   as vendor-neutral pure modules, server-usable (→ 4.3) · **run-rate / burn** projector (#881) ·
>   **capacity-vs-demand** engine (#882, → 4.2) · wired **EVM** (CPI/SPI/EAC) into the portfolio-financials
>   roll-up (#883, → 4.7). The analytics engines — critical-path, monte-carlo, run-rate, capacity, evm,
>   depreciation, consolidation — are now one **vendor-neutral functional core** in `lib/backend-catalogue`,
>   shared by every surface below the broker seam.
> - **Wave 3 — domain build-out + governance.** ✅ **`benefit`** realisation record + curve (→ 4.1, #885) ·
>   **`milestone`** record (→ 4.8, 4.10, #886) · **`change_request`** + **`stage_gate`** delivery-governance
>   records (→ 4.8, #887) · **`skill`** / **`resource_skill`** / **`leave`** people-depth records (→ 4.2, #888) ·
>   **`portfolio`** scope tier completing portfolio→programme→project (→ 4.3, #889) · **PERT** three-point
>   estimating engine as a pure catalogue module (→ 4.3, #890) · **per-domain `ruleset` governance** — every
>   business rule tagged by domain, a per-domain mode floor that tightens a whole domain at once, folded
>   through the existing tighten-only scope resolution (→ 4.8, #891). The governed record spine now spans
>   benefit / milestone / change-control / stage-gate / portfolio alongside the Wave-1 resource/assignment/
>   timesheet and skills/leave records, with PERT joining the vendor-neutral functional core.
> - **Wave 4 — decisioning + scenarios.** ✅ **funding-envelope** engine — envelope vs committed+forecast →
>   headroom / over-commit / burn-through, with portfolio roll-up (→ 4.3, #893) · **efficient-frontier
>   selection** engine — highest-value subset under a budget/capacity cap, greedy value/cost heuristic + exact
>   bounded knapsack DP (→ 4.3, #894) · **`booking`** soft-vs-hard resource-reservation record (→ 4.2, #895) ·
>   **WSJF / RICE** prioritisation engine surfacing the per-item scores the priority-weights engine blends
>   (→ 4.3, #896) · **scenario / what-if** comparison engine — NPV / ROI / benefit-cost ratio / payback over a
>   discounted cash-flow series, NPV-ranked (→ 4.3, #897) · **benefit / value Monte-Carlo** — the value half of
>   §4.3's Monte-Carlo, sampling benefit+cost to a net-value distribution with break-even / target probability,
>   P10 value-at-risk and a driver tornado (→ 4.3, #898) · what-if resource **reassignment** engine — reuses the
>   capacity engine to project the over-allocation delta of proposed moves before committing (→ 4.2, #900) ·
>   **multi-currency EAC/ETC** engine — converts mixed-currency cost lines to a base currency (gating each on
>   convertibility) then runs the EVM math (→ 4.1, #901) · **stage-gate criteria** evaluation engine — decides a
>   gate's pass/fail/pending/waived from its criteria (via the shared predicate engine) + approvals (→ 4.3, #902).
>   All pure functional-core with deterministic tests. The Wave-4 decisioning set is now **substantially
>   complete** — funding · selection · prioritisation · scenario NPV · benefit Monte-Carlo · resource
>   reassignment · multi-currency EAC/ETC · stage-gate criteria, atop the Wave-2 critical-path / schedule-cost
>   Monte-Carlo / PERT engines. **Remaining (surfaces + refinements, not core compute):** funding-source tranches
>   at the plan layer (→ 4.1) · the theme/bucket grouping is already served by the generic `rollup.ts` engine, so
>   only its portfolio-Kanban / roadmap surface remains (→ 4.3) · the gap-analysis roll-up surface (→ 4.2).
> - **Wave 5 — embedded AI + agile linkage.** ✅ **epic/initiative health-scoring** engine — weighted R/A/G bands
>   over risk dimensions (dependencies / blocked-work / timeline / ownership) with plain-English reasons, outputs
>   the canonical rag-vocabulary bands (→ 4.4, #904) · **OKR ↔ delivery linkage** roll-up — wires objectives to
>   delivery items and auto-rolls-up progress from BOTH key results and linked items with a `deliveryGap`
>   divergence signal (→ 4.5, #905) · **duplicate-demand detection** — Jaccard token-overlap over intake items →
>   ranked candidate pairs + union-find clusters (→ 4.4, #906) · **structured exec-digest / status-report**
>   generator — assembles the above engines' results into one deterministic digest an LLM narrates (→ 4.4, #907) ·
>   **capacity-based sprint/PI forecasting** — backlog + velocity → sprints/PIs with an optimistic/likely/
>   pessimistic band (→ 4.5, #909) · **cross-team critical-path** — reuses the CPM solver, annotates the path
>   with teams + surfaces the cross-team hand-off edges (→ 4.5, #910). All pure functional-core with deterministic
>   tests — the deterministic scoring/assembly cores the copilot narrates, with **no LLM in-core**. **Remaining
>   (out of this lane):** the portfolio-grounded copilot Q&A surface + NL→artifact (→ 4.4, the LLM-facing layer
>   atop these cores) · SAFe / Jira-Align + first-class SAP connector (→ 4.5/4.6, brokered integration).
>
> **P3M catalogue-engine programme status (Waves 0–5): pure-functional-core COMPLETE.** The programme has
> delivered its vendor-neutral deterministic compute core — 20+ engines/records in `lib/backend-catalogue`
> (EVM, critical-path, Monte-Carlo, run-rate, capacity, PERT, funding, portfolio-select, prioritise, scenario,
> benefit Monte-Carlo, reassignment, multi-currency EVM, stage-gate, health-score, OKR-linkage, demand-dedup,
> exec-digest, PI-forecast, cross-team critical-path, + the Wave-1/3 record types) with guarded divides and
> deterministic (no `Math.random`/`Date`) tests. The remaining 4.x competitive-parity work — portfolio-grounded
> copilot, NL→artifact, first-class SAP / Jira-Align connectors, brokered read models — is LLM-surface +
> broker-integration territory that belongs to a different lane, not the functional-core catalogue.

### 4.1 Financial / ERP-native depth (SAP's moat)
- 🔌 **Project→GL cost brokering** — surface actual cost postings, commitments, and WIP by WBS/cost-object, read live from SAP/Oracle/NetSuite; never posted or stored here.
- 🔌 **Event-based revenue recognition mirror** — display SAP EBRR results (fixed-price / T&M / periodic) as a read model; recognition stays in the ERP.
- 🔌 **Capitalization / CapEx-OpEx split, cost-center + procurement + HR-cost roll-ups** — brokered read models per scope.
- ❄ **Be the ledger** — own postings, settlement, actuals, revenue recognition at rest. Directly contradicts zero-at-rest; SAP's job, not ours.
- ✳ **Deeper cost engine at the plan layer** — multi-currency EAC/ETC, funding sources, chargeback/showback, rate-card versioning over time (extends existing rate-card + budget-plan). **Funding envelope ✅ (P3M Wave 4, PR #893)** — a pure **funding-envelope** engine (envelope vs committed+forecast → headroom / over-commit / burn-through, with portfolio roll-up). **Multi-currency EAC/ETC ✅ (P3M Wave 4, PR #901)** — a pure engine that converts mixed-currency PV/EV/AC/BAC cost lines to a base currency (gating each line on convertibility, surfacing the rest) then runs the existing EVM math on the totals. Funding-source tranches + chargeback/showback + rate-card versioning remain.
- ✳ **Benefits realization tracking** — planned vs actual benefit by initiative, tied to Goals/OKRs. **Record ✅ (P3M Wave 3, PR #885):** a governed **`benefit`** record type + realisation curve in the catalogue. **Planned-vs-actual roll-up ✅ (Finance-depth wave, PR #930):** `benefit-realisation.ts` — a pure `analyzeBenefitRealisation` crossing each benefit's planned vs actual value into variance / variance % / realisation ratio + a realised/overdue-at-risk/abandoned/on-track classification, with a portfolio roll-up by category and status and the realised-vs-outstanding value split. **Goals/OKR linkage ✅ (`okr-linkage.ts`)** already rolls objectives up from key results + delivery items. So the §4.1 pure-core lane is complete — the remaining items (funding-source tranches, chargeback/showback, rate-card versioning, project→GL cost brokering, revenue-recognition mirror, CapEx/OpEx split) are brokered/GL-posting (🔌) or the deliberate "be the ledger" non-goal (❄), out of the pure-functional-core lane.

### 4.2 Resource management & capacity planning

> **Resource Management wave ✅ (pure-core lane).** The one genuinely-missing pure-core engine here — the skills gap-analysis roll-up — was delivered (`skills-gap.ts`, **PR #929**, `analyzeSkillsGap`: per-skill qualifying supply vs demand, shortfall, guarded coverage, worst-gap ranking + bench). The **capacity-vs-demand allocation heatmap is already served by the existing `capacity.ts`** (`computeCapacity` utilisation grid) — no duplicate built — and brokered timesheet-actuals reconciliation is out-of-lane. So the §4.2 pure-core lane is complete.

- ✳ **Capacity vs demand at portfolio scale** — role/skill supply modelling, allocation heatmaps, over/under-utilisation. **Engine ✅ (`capacity.ts`, `computeCapacity`):** the utilisation grid (who is over-allocated, who has slack) per resource/period already exists; the histogram/heatmap **visualisation** is the SPA follow-on.
- ✳ **Skills/competency matrix + gap analysis**, **named + generic (role-based) resourcing**, **soft vs hard booking / reservations**. **Records ✅ (P3M Wave 3, PR #888; P3M Wave 4, PR #895):** governed **`skill`** / **`resource_skill`** (proficiency link) / **`leave`** record types (#888) plus the **`booking`** soft-vs-hard resource-reservation record (#895, %FTE allocation with a soft/hard type + date window). **Gap-analysis roll-up ✅ (Resource Management wave, PR #929):** `skills-gap.ts` crosses resource-skill holdings against per-skill demand into supply / shortfall / coverage per skill, worst-gap ranked, with the bench of held-but-not-required skills.
- 🔌 **Timesheet actuals reconciliation** — brokered from the timesheet SoR; drive utilisation + burn. *(Out of the pure-core lane — brokered read.)*
- ✅ **What-if resource scenarios (P3M Wave 4, PR #900).** A pure **reassignment** engine — applies proposed effort-shifts between resources to the baseline and reuses the capacity engine to project the per-resource + total over-allocation delta (with an `improved` verdict + rejected/clamped moves) before committing; same posture as the scheduler, nothing stored.

### 4.3 Portfolio analytics & decisioning
- ✅ **Portfolio scope tier + three-point estimating (P3M Wave 3).** A governed **`portfolio`** record type above programme completes the **portfolio → programme → project** scope hierarchy (PR #889), and a pure-functional **PERT** three-point estimating engine (mean, standard deviation, variance-summing roll-up, confidence band; deterministic tests) joins the catalogue's vendor-neutral compute core (PR #890) — the estimating substrate the scenario/optimisation work below builds on.
- ✅ **Scenario / what-if portfolio planning (P3M Wave 4, PR #897).** A pure **scenario** engine — per candidate: NPV (discounted), ROI, benefit-cost ratio and payback period over a net cash-flow series; scenarios NPV-ranked so a fund/defer/cut decision is made against one yardstick. (Capacity-envelope coupling to the funding engine remains a future refinement.)
- ✅ **Efficient-frontier / optimisation (P3M Wave 4, PR #894).** A pure **portfolio-selection** engine — highest-value subset under a budget (and optional capacity) cap: a deterministic greedy value/cost heuristic plus an exact bounded 0/1-knapsack DP, honestly flagging which ran.
- ✅ **Monte Carlo on schedule + cost + benefit (client-side compute; no data retained).** Schedule/effort via `monte-carlo.ts` (P3M Wave 2, PR #880) and the **benefit / value** half (PR #898) — sampling benefit+cost to a net-value distribution with break-even / target probability, a P10 value-at-risk and a driver tornado.
- ✅ **Stage-gate governance with gate criteria + approvals (P3M Wave 4, PR #902).** A pure **stage-gate** evaluation engine — decides a gate's `pending`/`passed`/`failed`/`waived` from its criteria (each a `ConditionSet` over the item context, evaluated by the shared `predicate.ts` engine) + approvals, with a weighted readiness score and ordered blockers, atop the Wave-3 `change_request`/`stage_gate` records (#887). **Roadmap / investment themes / strategic buckets:** the grouping/roll-up is already served by the generic `rollup.ts` engine (`groupBy` theme + `sum` metrics); only the portfolio-Kanban / roadmap **surface** remains.
- ✅ **Portfolio Kanban + WSJF/RICE/weighted-shortest-job (P3M Wave 4, PR #896).** A pure **prioritisation** engine computing the per-item WSJF (cost-of-delay / job-size) and RICE (reach·impact·confidence / effort) scores the existing priority-weights engine blends; deterministic ranking, guarded divides. (The Kanban board surface remains.)

### 4.4 Embedded AI / copilot grounded in the live portfolio *(where ServiceNow/MS are pulling ahead)*
- ✳ **Portfolio-grounded copilot** — Q&A + roll-ups over the *brokered* live portfolio (status, risk, "what slipped and why"), grounded at query time, nothing cached. The single highest-leverage AI item.
- ✅ **Epic/initiative health scoring (P3M Wave 5, PR #904).** A pure **health-score** engine — weight-averages per-dimension risk severities (dependencies / blocked-work / timeline / ownership) into a composite, classifies it into the canonical rag-vocabulary R/A/G band, and emits plain-English reasons worst-first; a portfolio roll-up ranks worst-health-first with per-band counts. Deterministic, no LLM in-core (ServiceNow Now Assist parity for the scoring core; the LLM narrates on top).
- ✳ **NL → artifact** already exists for primitives; extend to **NL → report / dashboard / screen / automation**.
- ✅ **AI status-report + exec-digest generation (P3M Wave 5, PR #907).** A pure **exec-digest** assembly engine — composes the health-score / okr-linkage / evm / demand-dedup RESULT objects into one structured digest (worst-band headline, top-N risks with reasons, OKR worst-objectives + delivery gaps, EVM cost/schedule status, duplicate counts) that an LLM narrates; no LLM and no recompute in-core, so the narration stays grounded in what the engine selected.
- ✳ **Agentic task monitoring / next-best-action**, **auto-summarise threads/wiki/proofs**. **Duplicate-demand detection ✅ (P3M Wave 5, PR #906):** a pure Jaccard token-overlap engine over intake items → ranked candidate duplicate pairs (with shared tokens) + union-find clusters; distinct from entity-resolution's identity-key matching.
- ⚠ **AI over historical trend data** — needs a retained corpus; only over the opt-in sidecar/history store, never core.

### 4.5 Agile / adaptive planning at scale
- 🔌 **SAFe / scaled-agile constructs** (ARTs, PI planning, program board, dependency mapping) — orchestrate over the brokered agile SoR (Jira etc.), Jira Align / Atlassian Align territory.
- ✅ **OKR ↔ delivery linkage (P3M Wave 5, PR #905).** A pure roll-up engine — wires objectives to their key results AND linked delivery items, auto-computes progress from both sides (milestone-binary or start→target ramp key results; weighted delivery completion), and surfaces a `deliveryGap` so a divergence (KRs claim 80%, delivery 30%) is visible; portfolio mean + status counts. The Goals/OKR cadence records already exist (Phase 3.2).
- ✅ **Capacity-based sprint/PI forecasting (P3M Wave 5, PR #909).** A pure engine — remaining backlog + per-sprint velocity → sprints and Program Increments to clear it, with an optimistic / likely / pessimistic band and a `feasible` flag; guarded (velocity ≤ 0 ⇒ null, never Infinity). Velocity is an input (derive from `capacity.ts` supply or historical throughput).
- ✅ **Dependency graph + critical-path across teams (P3M Wave 5, PR #910).** A pure engine — reuses the CPM solver (`critical-path.ts`), annotates the critical path with each activity's team, and surfaces the cross-team **hand-off edges** (where PI plans break) + per-team duration share. The SAFe/Jira-Align **orchestration** over a brokered agile SoR remains (integration territory, above).

### 4.6 Enterprise integration & data
- 🚧 **First-class SAP connector** (S/4HANA / PS / PPM read models) — the credibility connector; brokered, not
  stored. **Slice 1 ✅ (the read adapter + read models).** Broker gains OPTIONAL `listWbsElements` +
  `getWbsFinancials` (docs/SAP-CONNECTOR.md); read-model types `WbsElement` + `WbsFinancials` (available =
  budget − actual − commitment). Demo broker implements them from fixtures so the pipeline is testable with no
  SAP tenant. Routes `GET /projects/:id/wbs` + `/wbs/:wbsId/financials` — project-scope-gated, degrade to 501
  when a backend doesn't front an ERP, 404 on unknown WBS. 5 route tests + typecheck clean. **"SAP-light for
  everyone":** because these are broker methods, the same cost-structure experience is offered THREE ways —
  SAP, their **backend of choice** (mapped through the broker), or the **sidecar store** (authored/imported
  WBS+financials, zero-at-rest, the wiki/whiteboard sidecar pattern). SAP keeps the ledger; we bring the
  screens. **Slice 2 ✅ (the "copy of a SAP screen" as PURE JSON — no bespoke code).** The artifact is a JSON
  screen def (`screens/sap-project-cost.json`) using the GENERIC `table` panel bound to a rows read model
  (`GET /projects/:id/wbs/cost-rows` → `{ rows }`, the WBS+financials join). The only new code is ENGINE, not
  artifact-specific: generic `{projectId}` source-URL templating (`lib/panel-source.resolveSourceUrl`) so any
  JSON panel can bind a project-scoped endpoint — reusable everywhere, not SAP. (An earlier bespoke `sapCost`
  panel component was reverted: artifacts are JSON, never TypeScript.) Tests: panel-source 4/4, cost-rows route,
  BoundPanel/ScreenRenderer green. **Slice 3 🚧 (the mapping layer — "looks like SAP, stored in OpenProject").**
  `lib/wbs-mapping`: a PURE projector `applyWbsMapping(rows, mapping, projectId)` + `sanitizeWbsMapping`, mapping
  the screen's SEMANTIC fields to any backend's real field names (same idiom as `fieldOverrides`/`column-mapper`).
  Proven: OpenProject-shaped work packages → the IDENTICAL `WbsElement`/`WbsFinancials` read model the SAP
  fixtures produce (money-as-strings parsed, available computed, level from the parent chain); a third backend's
  headers give the same output. 4 tests. **Slice 3 continued ✅ (the field-mapping / superset series A–E5).**
  The mapping is now a FIRST-CLASS object: `lib/field-target` gives every field a `(broker, backend)` address
  (1:1:1); `lib/mapping` is a generic `mapping` def kind authored through the importer, subsuming the legacy
  `fieldRouting`; scope-resolved system→org→programme→project→user; homeless fields surfaced, never
  silent-defaulted. The read/write **sidecar** target (path 3) is built (`lib/wbs-sidecar`, `lib/mapping-sidecar`)
  with a generic `/projects/:id/mapping/:slot` read+write surface any screen/form/report can bind. The **live
  superset** (`lib/superset` + `GET /api/fields/superset`) is the union of backend-advertised fields ∪ org/
  programme `customField` defs; each field carries origin + type + length + regex; UI validation is DERIVED from
  each field's home and enforced on write; a SPA picker (`/field-mapping`) authors the backend↔superset↔UI
  triple. **Remaining (last mile, external):** the per-`(broker,backend)` read/write ADAPTERS that reach a
  genuinely different live SAP/OpenProject instance — the routing decision + sidecar leg are done; per-platform
  adapter instances bound to each endpoint are the remaining work (see §5 proof + `broker/registry.ts`).
- ✳ **Broader broker catalogue** — Oracle/NetSuite/Workday/MS Project/Smartsheet/monday/Asana/Azure DevOps read+write seams.
- ✳ **iPaaS / webhook-out / OData feed** (OData read already exists — extend), **bi-directional sync policies**, **field-mapping studio** (partly exists).
- ⚠ **Data warehouse / lakehouse export** — legitimate, but any retained extract needs the sidecar SoR + explicit retention, not core.

### 4.7 Reporting, BI & dashboards

> **Reporting/BI wave ✅ (pure-core lane).** The below-seam analytics engines for this section were delivered as a dedicated wave (one PR per slice, pure functional-core, deterministic tests, reuse-over-duplicate): the **burn-up / burn-down / cumulative-flow engine (PR #927)** and the **velocity engine (PR #928)**. The **cross-project pivot** was found to already exist — `rollup.ts` groups any rows by any field and aggregates sum/avg/count/min/max with an optional pivot dimension — so no new engine was built for it. What remains in §4.7 is surface work (scheduled delivery/subscriptions, PPTX/XLSX/PDF export, embedded external BI) — outside the pure-core lane.

- ✳ **Cross-project/portfolio pivot + drill-through** *(already served by the generic `rollup.ts` group-by/pivot engine)*, **scheduled report delivery / subscriptions**, **export to PPTX/XLSX/PDF**. *(The last two are out of the pure-core lane — delivery + export surfaces.)*
- 🚧 **Baseline vs actual variance + EVM suite** (SPI/CPI/EAC). **Slice ✅ (EVM engine, PR #874):** the pure
  `lib/backend-catalogue/src/evm.ts` now DERIVES the full suite from the PV/EV/AC/BAC primitives — CV/SV/CPI/SPI,
  all four EAC methods (cpi / budget-rate / cpi·spi / bottom-up-etc), ETC, **VAC**, and **TCPI** (to BAC and to
  EAC) — instead of reading them blind off the source; adds the missing `varianceAtCompletion` + `toCompletePerformanceIndex`
  fields. **Burn-up/down + cumulative flow ✅ (Reporting/BI wave, PR #927):** `flow-metrics.ts` — a pure
  `computeFlowMetrics` reconstructing per-period burn-down (vs a guarded ideal line), burn-up (with scope-change),
  a per-status-class cumulative-flow (backlog/active/done lanes) and throughput, over caller-supplied epoch-ms
  periods, measured by count or points; **velocity ✅ (Reporting/BI wave, PR #928):** `velocity.ts` derives
  mean/median/rolling/spread + a predictability score and optimistic/likely/pessimistic anchors from a throughput
  history, feeding `pi-forecast`. **Remaining:** a cost+schedule **`baseline`** snapshot record for true
  baseline-vs-actual variance (Wave 1) and wiring the engine into the live financials read (Wave 2).
- 🔌 **Embedded external BI** (SAC / Power BI / Tableau) via broker seam rather than re-implementing a BI engine.

### 4.8 Governance, risk, compliance

> **Risk & Governance wave ✅ (pure-core lane).** The pure engines + governance records for this section were delivered as a dedicated wave (one PR per slice, pure functional-core, deterministic tests, reuse-over-duplicate): **risk register / exposure-heatmap engine (PR #924)**, **decision-log + lessons-learned registers (PR #925)**, **per-methodology mandatory-gate policy (PR #926)**. What remains in §4.8 is SPA/surface work (the change-control **board UI**, the register/heatmap **visualisations**) and the compliance-evidence export — outside the pure-core lane.

- ✳ **Risk + issue register with scoring/heatmaps** (RAID exists in registers — deepen to scored matrices + mitigation workflow). **Engine ✅ (Risk & Governance wave, PR #924):** `risk-register.ts` — pure P×I exposure scoring over the shipped likelihood/impact/severity vocabularies, severity banding, a likelihood×impact **heatmap grid**, an exposure-weighted roll-up (by type/status/band, open vs closed, overdue mitigations) and a worst-first top-risk ranking. The heatmap/matrix **visualisation** is the SPA follow-on.
- ✳ **Change-control board / change requests**, **decision log**, **assumption + dependency registers** (some exist — formalise). **Records ✅ (P3M Wave 3):** governed **`change_request`** + **`stage_gate`** records (PR #887) and a **`milestone`** record (PR #886). **Registers ✅ (Risk & Governance wave, PR #925):** a **`decision`** log entity (status proposed/accepted/rejected/superseded, rationale, maker, supersedes-link) and a **`lessons_learned`** entity (category what-went-well/to-improve/risk/process), data-not-code alongside their `change_request`/`stage_gate` siblings; the board **UI** remains.
- ✳ **Audit-ready compliance packs** (SOC2/ISO evidence export) — leans on the tamper-evident audit chain we just shipped. *(Out of the pure-core lane — an export surface.)*
- ✳ **Policy-as-config guardrails** (mandatory fields/gates per methodology — composition gate exists, extend). **Slice ✅ (P3M Wave 3, PR #891):** **per-domain ruleset governance** — every business rule is tagged by domain (general/delivery/finance/people) and a per-domain mode floor tightens a whole domain at once, folded tighten-only through the existing system<org<programme<project scope resolution. **Mandatory-gate extension ✅ (Risk & Governance wave, PR #926):** `methodology-gates.ts` — a pure `evaluateMethodologyGates` that checks a project's stage-gate records against a methodology's required-gate policy (shipped PRINCE2 g0…g5 default, caller-overridable), **reusing `evaluateGate`** per gate; reports the unmet/missing blocking gates and whether the project is clear to proceed.

### 4.9 Config lifecycle & portability *(our wedge — sharpen vs SAP CTS/CTS+)*
- ✅ **Config diff / drift report between instances** — `lib/config-diff` (`buildConfigDiff(from, to, now)`)
  compares two full backups and reports WHAT CHANGED: settings by KEY (added/removed/changed — never values;
  secret-bearing keys flagged, never valued), def-store collections by scope+type then by `id` + `rowVersion`,
  and the sealed extra stores by PRESENCE only. `POST /api/setup/config-diff` (admin + fresh step-up; a side
  omitted defaults to LIVE, so `{ to }` previews "what restoring this backup would change" and a sealed side is
  decrypted with this instance's key first). SPA: a **Compare with backup** control in `BackupStep` renders the
  content-free change report (settings chips + per-collection id/version chips). Tests: config-diff lib 6/6
  (added/removed/changed, secret-flagged + content-free, scope grouping, presence-only stores, schema reject),
  export routes +2 (live-vs-uploaded + step-up gate, live-vs-live identical), BackupStep 25/25. Both packages
  typecheck clean. **Next in §4.9:** staged promotion (select a diff subset → apply dev→test→prod, signed + audited).
- ✳ **Staged promotion (dev→test→prod) for config/defs** — a lightweight, JSON-native answer to SAP transports; selective, reviewable, signed.
- ✳ **Config versioning + rollback timeline** (partially exists via config-store history — surface it), **change approval on config promotion**.
- ✳ **Benchmark doc: JSON-config portability vs SAP CTS/CTS+/cTMS** (research open question — quantify migration effort).

### 4.10 Work management & collaboration parity
- ✳ **Gantt with dependencies + baselines + drag-reschedule** (scheduler exists; add the interactive Gantt surface), **timeline/roadmap views**.
- ✳ **Portfolio calendar / milestone calendar**, **workload view**, **cross-project dependencies board**.
- ✳ **Forms → intake → triage → approval pipeline** (intake forms exist; add the demand-intake funnel + scoring).
- ✳ **@-mention notifications, watchers, digest rules** (presence/comments exist — extend to a notification centre).

### 4.11 Platform, extensibility, deployment
- ✳ **Marketplace maturation** (marketplace + registry exist) — ratings, versioned installs, paid/community tiers, signing.
- ✳ **Public API + SDK + API tokens + rate-limited developer portal** (API portal generated already — productise).
- ✳ **Multi-org / multi-tenant management console**, **SSO/SCIM breadth** (SCIM + OIDC exist — add SAML breadth, more IdPs).
- ✳ **Mobile-native shell** (PWA exists; the X.1 native-handoff bridge is the seam).
- ⚠ **On-prem "air-gapped" distribution** — feasible (self-host exists) but needs a supported offline update + license story.

### 4.12 Explicitly-not-building (logged so the decision is on record)
- ❄ Owning financial postings / becoming the ERP ledger (§4.1).
- ❄ Storing brokered project/issue data at rest to enable "faster" analytics — breaks zero-at-rest; use the broker + optional sidecar instead.
- ❄ A bundled proprietary BI engine — broker to SAC/Power BI/Tableau (§4.7).
- ❄ Re-selling "BYOK / data sovereignty" as a differentiator — the research showed SAP already offers BYOK/HYOK; keep it as hygiene, lead with zero-at-rest + portability instead.

## Phase 5 — SOTA parity gaps (July 2026 review)

Everything below is **possible but not yet done**, harvested from the point-in-time parity review
(`docs/archive/reviews/SOTA-PARITY-2026-07.md`, five gap clusters + a proof cluster) and the remaining last
mile of the field-mapping series. Items already covered in Phase 4 are cross-referenced, not repeated. Same
disposition legend (✳ fits · 🔌 broker-dependent · ⚠ tension · ❄ won't-build). Every item is ⬜ Todo unless
noted. **Inclusion is capture, not commitment** — several conflict with the zero-at-rest bet and carry a
state-respecting path.

**Priority read (the review's sequencing):** proof sweep (§5.6) → dependency-graph + sprint/epic entities
(§5.5) → collaboration layer (§5.1) → automation recipes (§4.1.2/§5.3) → agentic execution + evals (§5.2) →
multi-tenancy → managed offering (§5.4).

> **Reconciled against the code (2026-07-17).** The parity review's "verified by grep" was evidently not run
> against this branch's current state — a code audit of all 27 claims found **6 wrong or understated**, now
> corrected inline below: real-time CRDT co-edit + live cursors are **built (flagged)**, the encrypted offline
> read cache is **built (flagged)**, a block/rich editor already exists for the wiki (only comments are plain),
> Gantt cascade-reschedule already ships, the agentic **execution rails** already exist (only the AI-drive
> policy is unwired), and one-click **deploy templates** already ship (only the hosted tier is missing). The
> other 21 items verified as genuine gaps.

### 5.1 Interactive collaboration UX (bar: Linear / Monday / Asana / Notion)
- 🚧 **Rich-text on comments/descriptions** — *comments now render markdown-lite* (`components/issue-dialog/CommentsPanel.tsx`
  renders bodies through the shared, XSS-safe `MarkdownLite` renderer — bold/italic/code/links/lists/checklists, the
  same format task notes use), and the composer is a multi-line textarea (⌘/Ctrl+Enter to send). The body is stored as
  plain markdown **source** (a string), so the zero-at-rest posture and the backend write-through are unchanged. The
  wiki `DocEditor` remains the full block editor. **Remaining:** the full block editor (or CRDT co-edit) on issue
  *descriptions*.
- 🚧 **Mention autocomplete** — *a free-text `@`-typeahead now ships on the comment composer* (`lib/mention-suggest.ts`
  + `CommentsPanel`): a keyboard-navigable menu suggests handles drawn from the thread's own participants and inserts a
  server-parseable `@token`. Because the overlay owns no user directory (identity lives in the IdP/SCIM), the token
  stays free-text — exactly what the gateway already parses/notifies. **Remaining:** a richer candidate source if/when a
  project-members read becomes available.
- ✅ **Real-time CRDT co-edit + live cursors — BUILT (flagged); extend surface.** Yjs CRDT co-edit ships on the
  wiki block model (`lib/collab`, `lib/collab-doc`, `routes/collab`, default-off `wikiCoEdit` flag) and live
  cursors ship on whiteboards (`CanvasEditor.tsx`, `presence` toggle). The parity review listed this as a gap —
  it is wrong. **Remaining:** extend CRDT co-edit to issue comments/descriptions (still plain today).
- 🚧 **Interactive Gantt dependency editing** — *dependency arrows + link create/delete now SHIP* on the board
  Gantt (`components/board/GanttChart.tsx`): durable edges render as clickable SVG arrows (finish-to-start solid,
  `relates_to` dashed); a click-source-then-click-target handle pair creates an edge and clicking an arrow removes
  it, both through the existing durable `dependencies` slot hooks (`useWriteProjectDependency` /
  `useRemoveProjectDependency`) with the optimistic-write-then-revert pattern and contributor+ enforced
  server-side. *Note: cascade-reschedule already ships (`lib/cascade-reschedule`, `gantt-cascade-toggle`).*
  **Remaining:** bar-resize handles, a critical-path overlay on the timeline, and richer link types
  (FS/SS/FF/SF + lag — the durable edge is coarse `blocks/depends_on/relates_to` today, see §5.5). Extends §4.10.
- ✅ **Kanban swimlanes + WIP-limit enforcement — BUILT.** Board swimlanes render the view's optional
  `groupBy` Def field as horizontal lanes (`lib/view-engine/swimlane.ts`, `components/view-engine/RecordBoard.tsx`,
  PR #950) — the board counterpart to the list view's group-by, so a board and a list grouped by X partition
  identically. Per-column WIP limits ring the column and flag the count red when over (`BoardColumn.wip`, PR #945).
- 🚧 **Binary attachments — SHIPPING.** Real file upload/list/download/delete now works on issues via a
  **separate hardened `attachments-broker` sidecar** that holds the bytes below the seam. The bytes **never
  pass through the gateway at all**: the gateway mints a short-lived, HMAC-signed **ticket** and the browser
  transfers bytes **directly** to/from the sidecar's `/portal` (browser plane, CORS + ticket); the gateway
  keeps only a byte-free pointer and, server-to-server, HEAD-verifies + deletes blobs (server plane, bearer).
  So a (possibly malicious) upload is only ever inside the isolated sidecar container — best run on its own
  VM. Sidecar (`services/attachments-broker`, two planes + `ticket.mjs`), gateway seam
  (`routes/attachments.ts` ticket-mint/record/link + `lib/attachments-meta.ts`, off-by-default
  `ATTACHMENTS_SIDECAR_URL`; byte-path needs `ATTACHMENTS_SIDECAR_PUBLIC_URL` + `ATTACHMENTS_TICKET_SECRET`),
  and the SPA UI (`AttachmentsPanel`, default-off `attachments` feature) all ship. See `docs/ATTACHMENTS.md`.
  Uploads are **malware-scanned inside the sidecar before the blob is stored** (`scan.mjs`): always-on
  zero-dep heuristics (EICAR test signature + executable/script magic bytes, so a renamed binary is still
  caught) plus optional **ClamAV** (`clamd` INSTREAM, fail-closed by default) — a file that fails is rejected
  `422` and never written, so it never becomes downloadable and no pointer is recorded.
  **Remaining:** cloud object-store backends (S3/GCS/Azure) **in the sidecar** (SDKs connect out from the
  sidecar, never the gateway) + compose/Helm wiring (incl. the sidecar's browser-reachable ingress + a bundled
  ClamAV service).
- ✅ **App-native TOTP two-factor (IAM S7) — BUILT.** An authenticator-app second factor alongside the
  existing passkeys, for local/no-IdP self-host accounts (where an external IdP is present, MFA is best
  enforced *there* — the app already delegates step-up via OIDC/SAML). The crypto is the audited `otpauth` +
  `@noble/hashes` libraries (`lib/totp.ts`), never hand-rolled; the per-user secret + recovery-code hashes
  live in a **separately-keyed sealed store** (`lib/totp-store.ts`, `deriveKey(root, "totp:v1")`, scrypt for
  recovery hashes). Enrol → confirm → step-up → disable routes (`/api/auth/totp/*`) mirror the passkey
  step-up pair, re-issuing the session with a fresh `stepUpAt`; codes are single-use inside their window (a
  `lastStep` replay lock) and the verify paths sit behind the strict login limiter. The SPA settings panel
  (`TwoFactorAuth`: QR enrol via the `qrcode` lib, confirm, one-time recovery codes, disable) ships too.
- ✅ **Device & active-session inventory (IAM S8) — BUILT.** A signed-in user can see their own active
  sessions (this browser plus any other devices) and sign one out — the account-security hygiene surface that
  lets a user cut off a lost/stolen device without an admin. Sessions stay stateless sealed cookies; an
  **always-on session directory** (`lib/session-registry.ts`, alongside the existing concurrency cap and
  rotating-token sequence) records each live session — first/last-seen, user-agent, IP — keyed by the
  per-session `salt`, which **never leaves the server** (the inventory identifies each session by a
  non-reversible SHA-256 handle). Per-session **revoke** marks the session signed-out at the single
  `readSession` chokepoint on its next request, and — in a declared fleet (`REDIS_URL`) — publishes/reconciles
  a shared revoke marker so the sign-out propagates across replicas (mirrors the seq-mark pattern). Routes
  (`GET /api/auth/sessions`, `POST /api/auth/sessions/revoke` — one device by handle, or `{ others: true }` to
  sign out every *other* device; revoking the current one is a logout) gate on `readSession`, so a caller can
  only ever manage their own principal's sessions. Best-effort per-replica RAM, honestly scoped like the rest
  of the registry. The SPA **DeviceSessions** settings panel (`lib/sessions.ts` client + a device list with a
  friendly UA label, last-active time, per-device revoke and "sign out all other devices") ships alongside.
- ✅ **Global undo — BUILT.** App-wide undo/redo stack over recent field mutations via `Cmd/Ctrl+Z` /
  `Cmd/Ctrl+Shift+Z` and palette Undo/Redo actions (`lib/edit-history.ts`, `lib/use-undo-redo.ts`,
  `components/UndoRedoHotkeys.tsx`; PR #948), layered on top of the existing per-action toast undo.
- ✅ **Per-user notification preferences — BUILT.** Each user chooses their delivery channels (in-app / email
  / push), silences individual event kinds, and sets a daily quiet-hours window — stored on their own
  per-user prefs blob (rides the `/me/prefs` vault + the `A11yProvider` sync, no new route) and enforced at
  the in-app SSE plane. A pure evaluator (`@workspace/backend-catalogue` `notification-prefs.ts`) is the one
  source both the gateway (`notify-hub` snapshot-at-connect filter) and the SPA settings panel
  (`NotificationPreferences`) read; a `critical` kind (blocker/incident) can never be muted — the bell is a
  guaranteed floor. Extends §4.10. **Remaining (deferred):** per-user opt-out on the role-broadcast digests
  (they'd need to enumerate recipients) and a per-user timezone for quiet hours (evaluated server-local today).
- ✅ **Bounded encrypted offline read cache — BUILT (flagged).** The AES-256-GCM, session-scoped (key bound to
  `sub`, wiped on logout), 24h-TTL, allow-listed (tasks + my-work) on-device read cache ships (`lib/offline-cache`,
  `use-offline-cache`, default-off `offlineCache` flag; Phase 2.5). The parity review's "none" is wrong.
  **Remaining:** FULL local-first (write-behind sync) only — off-thesis.

### 5.2 AI — the capability half (bar: 2026 agentic)
- ⚠→✳ **Supervised agentic execution mode** — the execution RAILS already exist (`lib/autonomous-grant` is a
  default-deny grant registry pinning WHAT/WHERE/HOW-LONG + a per-process write cap + fail-closed audit +
  kill-switch `ai-kill` + short-lived minted principals `lib/autonomous`); the AI copilot is still propose-only
  (`capability-governance.ts` — every write human-confirmed). Gap = wiring an AI drive over those rails
  (pre-approved action classes, per-run budgets, step-by-step audit, instant revoke). A *policy* upgrade, not
  architecture — the review's framing is correct.
- ⚠ **Predictive / learned analytics** — risk scoring, delivery-date prediction, anomaly detection trained over
  the **customer-owned** time-travel/logging store + snapshot exports (models are derived artifacts; data stays
  theirs). Blocked until the time-travel plane is production-proven (§5.6). Deepens §4.4.
- ⚠ **Retrieval quality (RAG)** — an **ephemeral, per-session, in-memory** embedding index over the read model
  (copilot is snapshot-in-prompt today; 0 vector-index hits). Respects zero-at-rest.
- ✳ **AI evaluation / benchmark suite** — a golden-question corpus per surface (copilot Q&A, NL→action,
  estimation) with scored, regression-gated CI runs. Today these accuracies are candidly "unbenchmarked."

### 5.3 In-product automation (bar: B1 / B4) — extends §1.2
- ✳ **Durable scheduling** — external-cron-first (trigger endpoints exist) + an optional Redis-backed
  delayed-job mode (retries/backoff/dead-letter) on the shared-state seam. Schedulers are in-process
  `setInterval` today (lost on restart, per-replica).
- ✳ **Consumer-facing domain-event stream** — a full event vocabulary (issue.updated, project.created, …) over
  the outbound-webhook seam; the broker sees every write, so richer events are incremental. (3 event types today.)

### 5.4 Platform plumbing (bar: modern SaaS)
- ⚠ **Server-side / full-text search** — push search down to backends that support it (JQL, OpenProject
  filters) via a broker `search` capability, or an ephemeral per-session in-memory index. Global search is a
  client-side 8-project fan-out today; a persistent index is a copy (off-thesis).
- ✳ **Multi-tenancy (implementation)** — designed end-to-end (`docs/archive/design/MULTI-TENANCY-DESIGN.md`),
  not built; single-tenant today. Unlocks per-tenant rate plans/quotas + the pooled managed offering. Extends §4.11.
- ✳ **Third-party plugin runtime + sandbox + versioned extension API** — the seven-planes catalogue is the
  substrate; the missing layer is packaging/sandboxing/distribution (Forge/Monday-apps parity). Extends §4.11.
- ✳ **Hosted / managed tier** *(one-click deploy already ships)* — Railway one-click templates
  (`deploy/railway/*.railway.json`), a Helm chart (`deploy/helm`), and multiple compose profiles already exist,
  so the parity review's "self-host only, deploys pending" understates it. The real gap is the **hosted
  multi-tenant tier** (gated on the multi-tenancy implementation above). Extends §4.11.
- ✳ **GraphQL (or equivalent typed query API)** — REST + OpenAPI + OData today; noted because every B1 benchmark
  ships one (arguably optional given OData + generated clients).
- ✳ **i18n breadth** — 15–30+ full locales (4 curated today; framework ready).
- ✳ **Fleet-consistent runtime state** — move the per-replica RAM registries (session cap, settings store,
  audit-chain head, presence rooms, **the 200-entry governance log — flagged compliance gap**) onto the existing
  Redis/file-backed shared-state seam. Cross-refs TECH-DEBT §2.

### 5.5 Domain-model entities — DEFS over the generic slot surface, NOT engine code (bar: B1 / B2)
**Architecture correction (this session).** These are *not* bespoke `Broker` entities with their own PUT
methods — that would bake a methodology (agile) into the engine and duplicate the generic mapping/sidecar
surface. Each is a **row in a generic mapping slot** (`GET /mapping/:slot/rows`, `PUT`/`DELETE /mapping/:slot/:rowId`)
plus, where it has a UI, a screen/report **def** authored through the importer. The engine stays methodology-neutral.

**The pattern, now complete end-to-end (data + render) — via REUSE, not new primitives.** A domain
register/board/list is: (1) a `mapping` slot def (JSON, methodology-neutral data), + (2) a screen def whose panel
is an EXISTING primitive pointed at the slot. No new panel/primitive was needed:
- **Read-only** → the `table` panel with `source.url = /api/projects/{projectId}/mapping/:slot/rows` (columns
  derived from the rows) — zero config, already shipped.
- **Editable** → the existing **`register`** panel gained an additive `slot` source: the SAME editable grid, but
  it reads the slot's rows and on Save RECONCILES the draft against the server via per-row `PUT` + `DELETE`
  through the generic surface (instead of the whole-array PUT it does for settings collections). Columns from
  the def; the server re-validates.
So **every register is a pure JSON screen def, no bespoke code per entity** — and it reused the editable-grid
primitive rather than shipping a parallel one. The epics register ships as the first slot-backed `register`
screen; sprints/RAID/risks/milestones/stakeholders follow as defs.

**Same-pattern candidates surveyed (not yet done).** (a) **RAID → `raid` slot** — `listRaid`/`addRaid` are still
bespoke `Broker` methods returning `Row[]`; retire them into a slot (exact dependencies replay). (b) The
governance **registers** (risks, decisions, change-requests, lessons-learned, stakeholders) → slots + `data-slot`
screen defs, tagged `[prince2,waterfall]`. (c) **Hardcoded methodology data in the SPA** (`lib/methodology.ts`
`SPRINT_COLUMNS`/`WIP_LIMITS`/`PRINCE2_STAGES`) duplicates — and has **drifted from** — the methodology packs'
`tools.states`; read it from the resolved pack (the non-agile twin of the mapping-constant cleanup, fixes a live
drift bug).
- 🚧 **Explicit dependency graph** — durable directed edges. **The review's #2 priority:** unlocks interactive
  Gantt links, network diagrams, true critical path on live data, and cascade-reschedule.
  - **✅ Generic-slot model.** A dependency edge is a row in the shipped `dependencies` mapping slot
    (`{fromId, toId, kind: blocks|depends_on|relates_to, note?}`, id = composite `from·kind·to`), homed on the
    built-in sidecar by default (an admin can remap any field to a backend's native link API). CRUD via the SAME
    generic surface every slot uses; the one enabling addition was a generic **row DELETE**
    (`DELETE /mapping/:slot/:rowId` + `removeSidecarRow`) that completes read/upsert/delete for *all* slots.
    No `dependsOn[]` on the `Broker` contract, no `/dependencies` routes — those were removed. Zero-at-rest.
  - **✅ SPA consumes durable edges.** `lib/project-dependencies` reads `GET /api/projects/:id/mapping/dependencies/rows`
    and adapts each row into the `DependencyEdge` shape the schedulers already consume. Critical Path, the
    auto-schedule forecast, and the Gantt drag-cascade MERGE the durable slot rows with the browser-volatile
    overlay — live CPM + cascade run on real precedence. Write/remove hooks PUT/DELETE through the generic slot.
  - **✅ In-project link editor.** The board Gantt now renders durable edges as clickable arrows and
    creates/deletes them in place (`components/board/GanttChart.tsx`, source→target link handles + click-an-arrow
    to remove). **Next:** the network-diagram view + richer link types (FS/SS/FF/SF + lag) on the durable edge.
- ✳ **Sprints / iterations** — a `sprints` mapping slot (`{id, name, goal, startDate, endDate, state, itemIds}`)
  + a sprint-board screen def + a velocity/burndown report def, all authored through the importer (agile-only,
  loosely coupled). No engine entity. (A bespoke `Sprint` broker entity was prototyped, then reverted in favour
  of this def-based model.)
- ✳ **Epics / work-item hierarchy** — a `parentId` field/relationship on the work-item mapping (epic→story→subtask),
  authored as a def; no new contract entity.
- ✳ **Milestones & baselines** — a `milestones` mapping slot + the existing `baseline()` read; variance-to-baseline
  is a report def.
- ✳ **Per-entry worklog model** — time tracking is aggregate `loggedHours` + timesheets; no per-entry worklog.
- 🔌 **Live FX feed** — the fallback rate table is `provenance: "sample"`; broker a live FX source (ENTERPRISE-READINESS roadmap #1).

### 5.6 Proof — verified against the real world (bar: "state of the art in production")
The review's #1 cluster: much of the surface is proof-gapped, not feature-gapped. All are **possible** but need
external infrastructure a CI sandbox can't reach (so they are execution/attestation work, not code work):
- ✳ **Live n8n contract execution in CI** — run the generated contract workflow inside real n8n (queue mode).
  TECH-DEBT §1's single highest-value missing test. The load harness (`scripts/src/load-harness.ts`) is ready
  and correctly refuses to let demo numbers pass as real.
- 🔌 **2–3 live-tenant-verified flagship backends** — 0 of 41 catalogued are live-verified (SAP/Oracle/NetSuite/
  D365 "catalogued, not live"); SQL/Mongo sidecars untested against real DBs. Also the field-mapping **external
  read/write adapters** (§4.6 last mile).
- ✳ **Published scale / load result** — against a gateway wired to real n8n + backend; queue-mode numbers are placeholders.
- ✳ **Independent attestation** — pen-test summary, SOC 2 / ISO 27001 *certificates* (control mappings exist),
  GitHub native secret-scanning on. (Signed, published images now ship — `release.yml` pushes `omni-shell`
  to GHCR and attests the pushed digest, keyless SLSA; `gh attestation verify` works.)
- ✳ **KMS / vault / OTLP live verification** + **Authentik blueprint applied live** (mock-verified only today).
- ✳ **Tested multi-region DR runbook** + a multi-replica (not single-SQLite) sample manifest.
- ✅ **Exploration replica-workbench dirty-flag data-loss bug — FIXED** (per-source dirty tracking; commit
  `f565521`). One blocker to promoting time-travel/exploration out of Experimental/Beta is now cleared; the rest
  is end-to-end verification of the time-travel plane.

## Phase 6 — absorbed from the predecessor backlog (RFC-002)

[archive/design/RFC-002-roadmap.md](archive/design/RFC-002-roadmap.md) was the previous living
feature backlog (post-0.4.0), now marked superseded-as-live and pointing here. Most of its open
rows have since shipped (IssueDialog field-level gating via `GatedTextField`, `FinancialsPanel`,
duplicate-task, the `/resources` page, live Gantt drag, the explore replica workbench, a
catalogued Salesforce backend). Its still-open residue, carried so nothing is lost:

- ⬜ ✳ **Programme-as-entity** (`createProgramme` for backends with a real programme object) —
  gate on a backend declaring programme-as-entity; pairs with the §5.5 entity work and the
  programme def/binding tier (X.12/X.13).
- ⬜ ✳ **Per-backend manifest field declaration + generator emission** (RFC-002 §A) — re-verify
  against the current manifest/generator and the §4.6 field-mapping series before scoping;
  several sibling rows shipped since.
- ⬜ 🔌 **CRM entity read surfaces** (accounts / opportunities / contacts / cases) — Salesforce
  is catalogued as a backend; first-class CRM *entities* beyond the project/issue mapping remain
  unbuilt.
- ❄ **Delegation / temporary access transfer** — designed (RFC-004/RFC-005), deliberate NO-GO.
  Greenlight conditions recorded in RFC-002 §G: a real user asking, a token-exchange-capable
  IdP, and a named security reviewer owning the checklist.

## Status legend

- ⬜ **Todo** — not started.
- 🚧 **In progress** — actively being built.
- ✅ **Done** — shipped; record the commit/PR.

## Model migration — settings & artifacts into the composition model

The composition model is now complete: scope resolution (system < org < programme < project < user,
nearest-wins per field), an `extends` composition axis for defs, a declarative constraint engine (**policy** =
child-wins / **floor** = tighten-only, introducible at any node, escape only by branching above it), the
importer as the single validated write path, and bidirectional integrity + cascade guards. Every dimension a
settings slice or artifact needs already has a home in that model, so the remaining work is **re-expressing the
last bespoke subsystems as scoped-config defs** — repetition of the proven forms/screens/reports convergence,
not new invention.

Key unification: the existing **CHOICE vs SECURITY** settings classification (`lib/security-settings`) IS the
**policy vs floor** axis. A choice setting → a policy value (freely scope-overridable). A security setting → a
floor (the existing `relaxingKeys` / `applySettingsGuarded` sign-off gate to relax it is exactly "you can't
loosen a floor without approval / branching above"). Migrating settings is therefore mostly reclassification +
wiring onto one resolver, not new concepts.

**Recipe (every slice):** ① scope-resolve the value (reuse the mapping/def resolver) → ② classify each field
policy or floor → ③ move the write onto the importer choke point → ④ consumers read the RESOLVED value → ⑤
drain the legacy settings slice to read-only (never delete until the resolved path is proven green) → ⑥ tests +
full backstop + commit.

### Phase A — prove the pattern (pure policy, low blast radius)
- **Slice 1 · `scheduling` ✅ (config DefKind + resolver + full drain, NO compat).** A new `config` DefKind
  (logical `id` + partial `values` object) rides the importer choke point + sealed store like every other def.
  `lib/scoped-config` extracts the reusable `resolveScopedConfig(base, layers)` / `configDefLayers(id, scopes)` /
  `resolveConfig` — folds config-def layers across scopes (system < org < programme < project < user) via the
  shared `mergeValue` algebra. `scheduling` is fully migrated: its authoritative source is now an org-scope
  `scheduling` config def, scope-layered over the code default — **`settings.scheduling` removed entirely**
  (interface field, `FIELD_DESCRIPTORS` seed, `validateScheduling`, and the `security-settings` CHOICE
  classification all deleted; no compat layer, per the "remove legacy/compat code" directive). Reads:
  `GET /api/scheduling/resolved` (engine, scope-folded). Writes: `GET`/`PUT /api/scheduling` — a dedicated
  admin/PMO route (the generic `/api/defs` importer is behind a default-off module, so scheduling gets its own
  ungated validated write path, a singleton org config def with a stable id). SPA repointed off the settings
  slice. Two additions rode this slice: (a) **any artifact def may carry a loose optional `methodologies` tag**
  in its JSON — validated cross-kind at the importer (`defMethodologies` helper), the same convention the
  shipped screen/report catalogues use, generalised so any def is softly methodology-associable; (b) confirmed
  the **full org-level config-def tree rides the backup** (config defs are `def` artifacts → captured +
  re-validated on round-trip; test added). NB the deviation from recipe step ⑤ (drain-don't-delete): scheduling
  had no deployed legacy data to strand, and the directive was explicit, so it was a clean removal rather than a
  read-only drain.
- **Slice 2 · accessibility ✅ (org defaults → `accessibility-defaults` config def, no compat).** The org-wide
  accessibility default (partial UserPrefs) moved OUT of `settings.accessibilityDefaults` (field +
  FIELD_DESCRIPTORS + `security-settings` CHOICE classification all removed) into a scope-layered
  `accessibility-defaults` config def, folded system < org < programme < project via the generic resolver — so
  programme/project can ALSO default now, not just org. The USER scope is deliberately not a config layer: a
  user's own values are their sealed vault, which wins ON TOP (user-final policy — the org may only DEFAULT,
  never LOCK). `lib/user-prefs`: `orgAccessibilityDefaults(scopes)` / `effectiveDefaultPrefs(scopes)` /
  `getUserPrefs(sub, scopes)` gained optional scope args (default = org-level, callers unchanged);
  `setOrgAccessibilityDefaults` writes the singleton org config def. Dedicated admin/PMO route
  `GET`/`PUT /api/accessibility-defaults` (no SPA writer existed, so backend-only). Also made
  `sanitizePartialUserPrefs` drop null-coerced fields so the partial is idempotent across the config-def
  round-trip (a null default is not a default). `/api/me/prefs` still surfaces `orgDefaults`, now config-sourced.
- **Slice 3 · `branding` + `labelOverrides` + `priorityLabels`.** Presentation policy; proves deep object merge
  and nested scope override.
  - **`priorityLabels` ✅ (config def, route contract unchanged, no compat).** Custom priority-level display
    names moved OUT of `settings.priorityLabels` (field + FIELD_DESCRIPTORS + `security-settings` CHOICE all
    removed) into a scope-layered `priority-labels` config def, folded system < org < programme < project. The
    `GET`/`PUT /api/priority-labels` contract is IDENTICAL (`{ canonical, labels }`), so the SPA + its tests are
    untouched — only storage moved (settings → sealed config def; GET now accepts optional programme/project
    query for scoped resolution). Backend-only; full suite green.
  - **`branding` + `labelOverrides` ✅ (config defs + env default layer, no compat).** Both moved OUT of settings
    (`PresentationConfig` fields, `FIELD_DESCRIPTORS`, `brandingFromEnv`/`labelsFromEnv`, and the
    `security-settings` CHOICE classifications all removed) into `branding` / `label-overrides` ORG config defs.
    Resolution order: **org config def → `BRAND_*` / `LABEL_OVERRIDES` env default → product default** — env is
    kept as a first-class DEPLOY-TIME default layer beneath the org override (not a legacy shim; the login screen
    stays white-labellable pre-auth, read straight off the org sealed store without a session). The route
    contracts (`GET`/`PUT`/`DELETE /api/branding`, `GET`/`PUT /api/labels`, presets) are UNCHANGED, so the SPA is
    untouched. **Security:** the settings-restore path used to re-run branding through `sanitizeBranding` (the
    inline-style font-stack guard); since the generic config-def importer has no branding validator, that guard
    now runs DEFENSIVELY ON READ (`orgBranding`/`orgLabels` sanitise the stored values, rejecting a
    tampered/restored def before it can reach the inline style), covered by new premium-config tests.
    `brandingFromEnv`/`labelsFromEnv` moved to `lib/branding`/`lib/labels`; the env-seed tests assert them
    directly. Branding/labels now ride the DEF half of the full backup (config defs) rather than the settings
    snapshot. **Slice 3 complete.**

### Phase B — the larger choice slices (more consumers)
**Master seam ✅ — `settingsCollectionRouter` config-def mode.** ~25 collection routes (raci, stakeholders,
panelViews, savedViews, disabledScreens, collectionEditRoles, automations, templates, report-overrides,
resource-allocations, routing, …) share `lib/settings-collection-router`. It now has an OPT-IN `configId` mode:
a route flips from a `SettingsState` key to a scope-layered `config` def by passing `configId` + a carried
`validate` sanitiser — the HTTP contract is byte-identical (so the SPA never changes), and the collection leaves
settings. `lib/scoped-config` gained `readConfigCollection` / `writeOrgConfigCollection` (an array/object
collection rides the object-only `values` shape via a `{ value }` wrapper, so scope layers still deep-merge /
merge-by-id through `mergeValue`). **CHOICE-only** for now: config mode skips `applySettingsGuarded`, so a
security-classified collection stays settings-backed until the floor gate is wired onto this path (Phase C).
With the seam built, each remaining Phase B collection is a ~3-line flip (configId + validate + drop the
settings key/classification) plus a store-enabled route test.
- **Slice 4 · `screenLayouts` + `hiddenFields` + `savedViews`.** View/presentation policy (already partly
  scope-aware).
  - **`hiddenFields` ✅ (first config-def-collection adopter, no compat).** The admin/PMO view-curation list
    moved OUT of `settings.hiddenFields` (field + FIELD_DESCRIPTORS + `security-settings` CHOICE all removed)
    into a `hidden-fields` config def via the seam above. `GET`/`PATCH /api/availability/curation` contract
    unchanged (SPA untouched); `lib/availability` reads `readConfigCollection("hidden-fields", [])` fresh per
    resolve; the string-array sanitiser moved into the route. Backend-only; full suite green.
  - **`savedViews` ✅ (config-def collection, no compat).** Flipped `routes/views` to config mode (`saved-views`
    config def) — `settings.savedViews` removed (field + FIELD_DESCRIPTORS + CHOICE). `validateSavedViews` +
    `shapeChecked` are now exported from `lib/settings` and passed as the router's `validate`, so the rich
    view-engine validation (entity/viewKind/chart/timeline/style) is unchanged — its tests moved to call
    `validateSavedViews` directly. `GET`/`PUT /api/views` contract + `savedViews` feature-module gate unchanged
    (SPA untouched). **`screenLayouts`** is a separate target: it folds INTO screen defs (per-screen), not a
    standalone config collection, so it's not this seam's job.
- **Slice 5 · `collectionEditRoles` + `disabledScreens` + `panelViews` ✅ (batch flip, no compat).** All three
  flipped to config-def collections via the seam; settings keys + FIELD_DESCRIPTORS + CHOICE classifications
  removed. Validators: `stringArrayField`/`validatePanelViews` exported from `lib/settings` and reused;
  `validateCollectionEditRoles` extracted into its route. `lib/collection-edit-policy` (`editPolicyFor`, the
  hot-path write gate read by RACI/stakeholders/panelViews/…) now reads `readConfigCollection("collection-edit-roles")`
  instead of settings. Route contracts unchanged (SPA untouched); route tests store-enabled and drive
  `collection-edit-roles` via `writeOrgConfigCollection` (RBAC-independent setup). NB `disabledFeatures` stays a
  settings key for now (it's the feature-module toggle read all over `feature-modules`; a later slice). Full
  suite green.
- **Slice 6 · `automations` + `templates` + `raci` + `stakeholders` + `methodologyComposition`.** Remaining
  choice content slices.
  - **`raci` + `stakeholders` ✅ (batch flip, no compat).** Both register stores flipped to config-def
    collections (`raci` / `stakeholders`) via the seam; settings keys + FIELD_DESCRIPTORS + CHOICE removed, and
    the now-unused `validateRaci`/`validateStakeholders` imports dropped from `lib/settings`. The routes pass
    `normalisedBy(validate…, …Error)` as the config-mode `validate`; the `/raci/rows` + `/stakeholders/rows`
    endpoints repointed to `readConfigCollection(…)`. Route contracts unchanged (SPA untouched); the route test
    is store-enabled and drives both registers + the edit-policy via `writeOrgConfigCollection`.
  - **`automations` + `templates` ✅ (batch flip, no compat).** Both flipped to config-def collections
    (`automations` / `templates`) via the seam; settings keys + FIELD_DESCRIPTORS + CHOICE removed and the
    now-unused imports dropped from `lib/settings`. The routes pass `normalisedBy(validate…, …Error)` as the
    config-mode `validate` (each has a standalone validator + its own `Error` class); the automations `/run`
    endpoint repointed to `readConfigCollection`. Route contracts unchanged (SPA untouched); route tests
    store-enabled and seed via `writeOrgConfigCollection`.
  - **`methodologyComposition` ✅ (dedicated route, no compat).** The composition is a NULLABLE `string[] | null`
    (`null` = uncurated, everything visible), so it can't ride the array-collection seam whose default is `[]`.
    It moved to a dedicated `methodology-composition` config def with a null-preserving `{ value }` wrapper:
    `lib/scoped-config` gained `resolveMethodologyComposition` (reads `readConfigCollection<string[]|null>(…, null)`),
    and a new `routes/methodology-composition` (GET any-authed; PUT admin/PMO, validated `null | string[]`)
    replaces the old settings slice. All consumers repointed: the output hard-gate (`lib/composition-gate`),
    reference rulesets (`routes/ruleset`) and reports (`routes/reports`) now read `resolveMethodologyComposition()`
    instead of `getSettings().methodologyComposition`; the SPA `methodology-composition-api` hooks repoint to
    `/api/methodology-composition` while keeping the `{ data }` shape callers destructure. `settings.methodologyComposition`
    removed (field + FIELD_DESCRIPTORS + CHOICE). Store-enabled route tests cover the new route + the gate paths.

  **Phase B choice slices complete.** Every choice-classified collection now lives in the composition model as a
  scope-layered `config` def; `SettingsState` retains only security-classified keys (Phase C) and the handful of
  toggle/registry keys still read module-wide (`disabledFeatures`, `reports`, …). Next milestone: Phase C floor gate.

### Phase C — security/floor slices (introduce the floor + sign-off wiring)
- **Slice 7a · the floor-gate MECHANISM ✅ (built + proven; no real key migrated yet).** The config-def analogue
  of `settings-guard`, so a security-classified collection can leave settings and STILL be governed by the §0
  invariant (a relaxation is held for a signed sign-off). Mirrors how Phase B shipped the "master seam" before
  any flip.
  - **`lib/security-config`** — `SECURITY_CONFIGS: Record<configId, RelaxPredicate>`, the config-def analogue of
    `SECURITY_SETTINGS`. A config is guarded IFF registered here (starts empty; each Phase C migration slice adds
    its predicate). `relaxingConfig(configId, old, new)` / `isSecurityConfig(configId)`.
  - **`lib/config-guard`** — `applyConfigCollectionGuarded(configId, name, value, proposedBy)`: reads the current
    resolved value, and if the (already-validated) `value` relaxes the posture, SEALS the write (config-crypto,
    so a secret never sits plaintext in the shared queue) and raises a proposal on a new `config.relax` action
    (bound dual-control chain, or the solo confirm+sign degrade) — applied by the registered executor only once
    signed. A strengthening/neutral write, or a non-security config, applies immediately. A line-for-line analogue
    of `settings-guard` but persisting via `writeOrgConfigCollection`.
  - **`settings-collection-router` config mode** now consults `isSecurityConfig(configId)`: a security config
    writes through the gate (202 + `pending` on relax, exactly like `applySettingsGuarded`), a choice config
    writes directly. No new option — the classification alone flips the behaviour, mirroring settings.
  - Tests: `config-guard.test` (strengthen→immediate, relax→held→applied-on-sign-off, non-security→immediate,
    driving the real passkey sign-off ceremony) + `settings-collection-guard-routes.test` (the router's 202/200
    branches over a real Express app). Full suite green.
- **Slice 7b · migrate the security-classified slices.** With the gate in place, each registers its predicate in
  `SECURITY_CONFIGS`, adds a route, and repoints readers + the SPA off `PATCH /settings`.
  - **`errorTelemetry` ✅ (first security-config migration, end-to-end).** The admin opt-in for internal
    client-error reporting left `SettingsState` for the `error-telemetry` config def. `security-config` registers
    the directional predicate (enabling relaxes → sign-off; disabling immediate); `scoped-config.resolveErrorTelemetry`
    reads org def → `ERROR_TELEMETRY` env default → false (env kept as the deploy-time BASE layer, not compat); a
    dedicated `routes/error-telemetry` (GET any-authed; PUT admin → 202-on-enable via the floor gate) replaces the
    settings slice; `routes/client-errors` reads the resolver. Removed from settings (field + descriptor + the
    `SECURITY_SETTINGS` classification) and from the OpenAPI `Settings`/`SettingsUpdate` schemas (codegen + the
    embedded bundle regenerated). SPA: hand-written `error-telemetry-api` hooks (`useErrorTelemetry` /
    `useSaveErrorTelemetry`, which surfaces the 202 `pending` in the toast) repoint `ErrorTelemetrySync` (read) and
    `ErrorTelemetrySettings` (write) off `useGetSettings`/`useUpdateSettings`. New route test + config-guard cover
    the gate; SPA tests reseed the new query key. Full suite green.
  - **`loggingSync` ✅ (egress config, own module, end-to-end).** The opt-in state-history egress (the "logging
    server", unlocks time-travel) left `SettingsState` for the `logging-sync` config def. It got its own module
    `lib/logging-sync` (mirroring `branding`/`labels`): the `LoggingSyncConfig` type, `loggingSyncFromEnv` (the
    `LOGGING_SYNC_*` env BASE layer), `sanitizeLoggingSync` (url + warranty-ack gate → 400), `resolveLoggingSync`
    (org def → env → off) and `isTimeTravelEnabled`. `security-config` holds the directional relax predicate
    (enable, or redirect-while-on, relaxes). A dedicated `routes/logging-sync` (GET any-authed; PUT admin →
    202-on-enable via the floor gate) replaces the settings slice; `capabilities` + `routes/history` read
    `isTimeTravelEnabled` from the new module. Removed from settings (type + field + env-seed + validator + the
    `SECURITY_SETTINGS` classification), from the `settings-constraints` enable-lock (now the route validator +
    the panel's local guard), from `config-snapshot` `EXCLUDED_KEYS` (its egress url rides the sealed org config-
    def backup, not the settings snapshot), and from the OpenAPI schemas (client + bundle regenerated). SPA:
    hand-written `logging-sync-api` hooks (surfacing the 202 `pending`) repoint `LoggingSyncSettings` off
    `useGetSettings`/`useUpdateSettings`. New route test + the security/history/rbac integration tests repointed
    to `/api/logging-sync` + the sealed store. (Also fixed 3 SPA composition tests left seeding the pre-6c
    `["settings"]` key — now `["methodology-composition"]`.) Full suite green.
  - **`historyRetention` ✅ (own module, floor gate; backend-only).** The snapshot cadence (org default + PMO
    programme/project overrides) + the org-wide disposal window + legal holds left `SettingsState` for the
    `history-retention` config def. New `lib/history-retention` (type + default + `sanitizeHistoryRetention` +
    `resolveHistoryRetention` + `retentionDaysNow`/`legalHoldsNow`); `security-config` holds the
    SHORTENING-is-a-relaxation predicate; `routes/history` keeps its admin/PMO authority checks and routes the PUT
    through the floor gate (a shortening → 202 held, else applies). Repointed the audit-critical readers
    (`audit-chain` evidence-log prune, `dsar` window, `history/lifecycle` disposal + legal holds). Removed from
    settings + `SECURITY_SETTINGS` (the now-empty `HistoryConfig` sub-config dropped). No SPA surface; not a
    contract field. New shorten→202 / lengthen→200 route coverage; unit tests repointed.
  - **`selfHost` ✅ (own module, CHOICE config; backend-only).** The self-host DB adoption config left
    `SettingsState` for the `self-host` config def. NB it migrated as a CHOICE, not floor-gated: its real gate is
    the disclose-don't-insure ACKNOWLEDGEMENT (kept in `sanitizeSelfHost`), and it's authored through the admin
    setup wizard (`POST /api/setup/self-host`), which has always applied immediately — never a sign-off. Its
    former `SECURITY_SETTINGS` `changed` classification only guarded the bulk `PATCH /settings` backdoor, which
    can no longer reach it once it leaves settings. New `lib/self-host-config` (type + default + sanitize +
    `resolveSelfHost`); `routes/setup` GET/POST read the resolver + write via `writeOrgConfigCollection`;
    `selfhost/runtime` + `timesheets/store` repointed. Removed from settings, `SECURITY_SETTINGS`, the
    `settings-constraints` ack-lock, and `config-snapshot` `EXCLUDED_KEYS`. SPA already talked to the setup route
    via hand-written hooks → zero SPA change. Not a contract field. Full suite green.
  - **Not migrated (documented, deliberate).** `brokerUrl`/`backendSource`/`oidcIssuerUrl` are boot-time TRUST
    ROOTS read across the broker seam before any org/scope context exists — deployment control-plane, not
    scope-layered config; forcing them into config defs would be high-risk and semantically wrong. `webhooks`,
    `federatedPeers`, `capabilityStates`, `workflowAcceptances`, `approvalChains`, `approvalBindings`,
    `featureGovernance`, `governanceRules` are the security MACHINERY itself (dedicated passkey/step-up routes,
    fail-closed governance controls) — not "choices with a floor". Roadmap "session controls" has no concrete
    settings keys. These stay in `SettingsState`.
  - **Cross-scope FLOOR resolver ✅ (the "lower scope may only TIGHTEN" mechanism).** `lib/scoped-config` gained
    `resolveFloorConfig(base, layers, tighten)` — folds scope layers base→leaf clamping each to be no looser than
    what it inherits, so the org sets the ceiling and every lower scope can only restrict further — plus
    `tightenAllowlist` (the allowlist tighten step: `null` = no restriction; both present ⇒ intersection, so a
    lower scope can drop an allowed id but never add a forbidden one). Distinct from the default nearest-wins
    `resolveScopedConfig`. Unit-tested (intersection, widen-is-a-no-op, null inheritance).
  - **AI selection allowlists ✅ (FLOOR configs; net-new governance) — provider + model + STT.** There was no
    existing allowlist setting — `aiProvider`/`aiModel`/`sttProvider` are the *selections* — so these ADD governance
    floors rather than migrating keys. `lib/ai-allowlist` holds three config defs (`ai-provider-allowlist`,
    `ai-model-allowlist`, `stt-provider-allowlist`), each resolved with the floor fold, with `aiProviderAllowed` /
    `aiModelAllowed` / `sttProviderAllowed` (`"none"`/off and the empty/default model always permitted).
    `routes/ai-allowlist` authors the ORG ceilings (admin PUT; lower scopes narrow via their own imported config
    defs); the SELECTION gate lives in `routes/settings` — a `PATCH /settings` that picks a provider/model/STT
    engine outside the resolved allowlist is rejected 400 before the write. Route test covers GET/PUT + the three
    enforcement gates + off/default/unrestricted. **SPA ✅:** `ai-allowlist-api` hooks; the System-Configuration
    provider + STT pickers filter to their allowlists (keeping off + the current value visible), the model input
    becomes a dropdown of allowed models when restricted (free-text otherwise), and one `AiAllowlistsAdmin` panel
    (registered in `ADMIN_PANELS` + `SETTINGS_PANEL_KEYS` as `aiAllowlists`) authors all three ceilings —
    provider/STT as checkbox sets, models as a free-text list. Panel + helper + picker-filter tests green.

  **Phase C sensible-subset complete.** The floor gate (7a) + four security-key migrations (errorTelemetry,
  loggingSync, historyRetention, selfHost) + the cross-scope floor resolver + the AI provider/model/STT allowlist
  floors (server enforcement + SPA) are all in. The boot-time trust roots and the passkey/step-up security
  machinery stay in `SettingsState` by design (documented above). Phase C is done.

### Phase D — artifacts' template/schema layer (content stays sealed data, zero-at-rest)
- **Slice 8 · schema families.** proof-annotation kinds, invoice-line schema, goal key-result kinds,
  canvas/whiteboard element schema, wiki block schema — already primitive FAMILIES; make them composable defs
  (extends + constraints) so an org can define a custom annotation/line type. The CONTENT stays sealed data.
- **Slice 9 · artifact templates.** starter wiki page, invoice layout, whiteboard template → composable shipped
  defs (like the Tier-1 dashboards), forkable at any scope.

### Phase E — unify + retire
- **Slice 10.** Once every slice is a scoped-config def, retire the bespoke settings PUT/resolution: `settings.ts`
  becomes a thin READ-VIEW over resolved config. One resolver, one write path, one governance model. Fold
  `CHOICE_SETTINGS`/`SECURITY_SETTINGS` into the per-field policy/floor classification so the settings drift
  guard and the constraint model become the same thing.

### Sequencing guardrails
- Slice 1 fully (incl. extracting `resolveScopedConfig`) before parallelizing — everything after is thin.
- **Never migrate a security slice before Slice 7** (the floor + sign-off wiring exists).
- Each slice independently shippable + REVERSIBLE — drain, don't delete, until the resolved path is proven.
- Full backstop every slice — the settings drift guards are the safety net; keep running them.
