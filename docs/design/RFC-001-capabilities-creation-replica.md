# RFC-001 — Field-map capabilities, entity creation, and the explore replica

**Status:** Draft for review (no code yet).
**Scope:** three interlocking features. The **field map is the foundation**; the
other two should respect it.

> Principle throughout: everything stays **broker-agnostic and above the seam** —
> new behaviour goes on the `Broker` interface and the `Capabilities` contract,
> never as backend-specific code in the data path. A backend opts into a feature
> by *declaring support*, not by the app assuming it.

---

## 1. Per-backend field map *(foundation)*

**Goal:** "the programmes entity and any field/option should only exist if the
backend can support it." Today capabilities are **domain-level** (`scheduling:
true`) and read-flavoured. Make them **field-level** with a **surface vs. store**
distinction, and gate **entities** (programme, project) the same way.

### Contract (`Capabilities` additions)

```yaml
FieldSupport:
  type: object
  properties:
    surface: { type: boolean }   # can be READ/displayed from this backend
    store:   { type: boolean }   # can be WRITTEN back to this backend
  required: [surface, store]

Capabilities:           # extends the existing domain flags
  fields:               # issue/work-item fields
    type: object
    additionalProperties: { $ref: '#/components/schemas/FieldSupport' }
  entities:             # higher-level entities
    type: object
    additionalProperties: { $ref: '#/components/schemas/FieldSupport' }
```

- **Field keys** (open strings, documented canonical set): `title`, `status`,
  `priority`, `assignee`, `description`, `labels`, `startDate`, `dueDate`,
  `storyPoints`, `completionPct`, `programmeId`, …
- **Entity keys:** `project`, `programme`, `raid`.

### Where it's declared

Each `BackendManifest` in `n8n-backends.ts` gains a `fields` / `entities` map.
The gateway folds it into `getCapabilities` (already brokered, so still
backend-driven). A `DEFAULT_FIELDS` helper sets the always-true core (`title`,
`status`) so basic trackers work with zero config.

### SPA usage

One helper off `useGetCapabilities`:

```ts
canSurface("startDate")     // render the field?
canStore("startDate")       // editable, or read-only?
canSurface("programme")     // show Programmes nav / rollups at all?
```

Drives: which `IssueDialog` inputs render (and read-only vs editable), which
board/table columns show, and whether the **Programmes** entity exists in nav and
routing.

### Open decisions
1. **Missing-key semantics** — absent field ⇒ `surface:false` (strict, hide) or
   permissive? *Recommend:* core fields default true; everything else absent ⇒
   hidden. Gateway emits explicit booleans so the SPA never guesses.
2. **Field vocabulary** — open strings + a documented canonical list (recommend),
   vs a closed enum in the contract (stricter, but every new field is a contract
   change).
3. **surface && !store** ⇒ render read-only (recommend) vs hide.

**Rough effort:** contract + codegen + gateway fold + manifest maps for the
shipping backends + SPA gating helper & wiring ≈ **3–4 days**.

---

## 2. Entity creation — projects & programmes *(depends on §1)*

**Goal:** add projects/programmes from the dashboard — but only where the backend
can store them.

### Contract / Broker
- `createProject` (POST `/api/projects`) and `updateProject` (PATCH
  `/api/projects/{id}`) — the latter is how `programmeId` gets set/cleared.
- New `Broker` methods `createProject` / `updateProject`; implemented in
  `N8nBroker` (brokered `create_project` / `update_project` actions) and
  `DemoBroker`. Manifests declare support via `entities.project.store` /
  `entities.programme.store`.

### Programmes are still derived
There is **no** `createProgramme`. A programme exists when ≥1 project carries a
`programmeId`; you "create" one by setting that field on projects, and "delete" it
by clearing it on all members. So programme creation = `updateProject` +
`entities.programme.store`.

### SPA
- A **New Project** affordance, shown only if `entities.project.store`.
- A **programme assignment** control on project detail, shown only if
  `entities.programme.store`.

### Open decisions
1. **RBAC** — manager+ to create projects / set programme grouping? (Recommend
   manager+.)
2. **Scope** — is project *creation* even desired given the read-through
   philosophy, or only programme grouping on existing projects? (Grouping is the
   higher-value, lower-risk half.)
3. Identifier/key handling on create (backend-generated vs user-supplied).

**Rough effort:** ≈ **3–5 days** (contract + 2 broker methods + manifests + SPA),
less if scoped to programme-grouping only.

---

## 3. Explore replica — increment 2 (mount live views snapshot-backed)

**Goal:** `/explore` runs the **whole real app**, every read/write resolving
against a chosen snapshot (increment 1 — the engine + interception seam — is
merged in #86).

### Approach
- An `ExploreReplicaProvider` that, on enter, installs
  `setFetchInterceptor(req => resolveReplica(replica, overlay, req))` and renders
  the **existing** pages/router inside the explore shell — no component changes.
- A **source picker**: *Capture now* (`captureReplica`, with progress for large
  portfolios) or *Import* a replica file. The chosen replica is the source of
  truth.
- **Edits** use the volatile overlay already built; honour §1's field map
  (read-only where `store:false`).
- **Provenance:** reuse the hazard ribbon; data badged `replayed`.

### Open decisions
1. **Routing** — a nested `/explore/app/*` mirroring live routes, vs a mode flag
   that swaps the data source under the same component tree. *Recommend:* mode
   flag (less duplication).
2. **Replica storage** — sessionStorage (durable across reload, but size-capped)
   vs in-memory (no cap, lost on reload). Deep snapshots can be large; recommend
   in-memory + export-to-keep, with a size warning.
3. **Capture cost** — a big portfolio is N×7 reads; needs a progress UI and a
   cap/streaming.

**Rough effort:** ≈ **4–6 days**.

---

## Sequencing

```
§1 field map ─┬─> §2 creation (gates on entities.*.store)
              └─> §3 replica honours the field map
§3 increment 2 can start in parallel with §1 (independent), then adopt the map.
```

**Recommended order:** §1 → (§2 ∥ §3). The field map unblocks honest gating in
both of the others, so it goes first.

## Combined risk / maturity note
All three are **Beta-class** on delivery (new, tested, not yet hardened by real
backends). §1 touches the public `Capabilities` contract (additive, non-breaking).
§2 is the only one that introduces *write* operations to new entities — the
highest-care item (RBAC, concurrency, and "is this in scope for a read-through
overlay" all apply).
