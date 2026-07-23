# Software Update — design & scope (proposed)

> **Status: proposed / scoping.** This documents a *planned* feature, not shipped behaviour. It is the
> design intent + the release-descriptor contract for admin-driven software updates. Read alongside
> **[DESIGN-PRINCIPLES.md](DESIGN-PRINCIPLES.md)** (esp. §1 stateless overlay, §10 fail closed, §13 clean
> boundaries), **[ENTERPRISE-OPS.md](ENTERPRISE-OPS.md)** (DR / restore), and **[CLOUD-HOSTING.md](CLOUD-HOSTING.md)**
> (deployment). When this ships, the parts that describe real behaviour move into those docs and this keeps
> only the rationale.

## 1. The reframe: the hard part is already the architecture

OmniProject is a **stateless overlay, zero-at-rest** (principle §1). Project data lives *below the broker
seam* in the systems of record; the gateway holds only **sealed configuration**. So "decouple the data from
the code, replace the code, recouple the data" is not a data migration — it is already true by construction.
The only thing that couples a running instance to *its world* is **key + sealed-config continuity**:

- the sealed `OMNI_CONFIG_DIR` stores (config store, vault, SCIM/security state, audit-chain head, wrapped
  instance key), and
- the matching key material (`SESSION_SECRET`, the config-at-rest key `CONFIG_KEY_RAW`/KMS, the vault root,
  the IRK).

A code swap that preserves those brings the instance back up with its data intact. Business data is never
touched. **The update feature is therefore a coordinator over the existing backup / seal / key machinery,
plus a small amount of net-new release plumbing — not a bespoke data pipeline.**

## 2. The defining constraint: the gateway cannot replace its own container

A running process cannot swap the image it is running from. There is **no Docker socket mounted into the
shell** (the standalone stack mounts a *filtered, read-only* socket into Traefik only). Code is updated today
by an **image-tag bump + orchestrator restart** — `docker compose up -d`, `helm upgrade --set image.tag=…`,
or a k8s `Deployment` rollout (`k8s-enterprise-manifest.yaml` uses `strategy: Recreate` because the
`ReadWriteOnce` config PVC can't attach to two pods at once). Container lifecycle belongs to the orchestrator.

**Consequence for the design:** the gateway **orchestrates and gates** an update; an external **deploy agent**
(per deployment target) **performs** the container swap. The gateway may *request, verify, gate, health-check
and audit* — it must never assume it can restart itself. This is the single biggest shape-determining fact,
and it differs by target (self-host compose vs k8s/Helm vs a managed control plane).

## 3. Reuse map — what already exists

The "backup → decouple → reload → recouple" spine is built. The update feature composes it:

| Step | Reuse | Where |
| --- | --- | --- |
| Automatic backup before update | sealed full-backup; IRK-sealed portable bundle | `lib/full-backup.ts`, `lib/instance-backup.ts` |
| Decouple data from the box | Instance Recovery Key (wrapped, reveal-once); sealed stores; KMS envelope | `lib/instance-key.ts`, `lib/config-crypto.ts` |
| Reload settings in-process (no restart) | `activateEnvironment` / `applySnapshot` → `updateSettings` | `lib/config-store.ts` |
| Recouple on the new version | full-restore / portable-restore (rotates to a fresh IRK) | `routes/setup/config-io.ts` |
| Preview a change (content-free diff) | `POST /setup/config-diff` | `lib/config-diff.ts` |
| Version history, rollback, "known-good" pin | append-only version model; `rollbackToLastKnownGood` | `lib/config-store.ts` |
| Freeze traffic during the swap | maintenance lockdown (`PUT /admin/maintenance`) | `lib/maintenance.ts` |
| Sign an artifact (Ed25519) | `signMessage` / `verifySignature` | `lib/signing.ts` |
| Gate the action | admin + `requireStepUp`; four-eyes (`heldForDualControl`) | `lib/step-up.ts`, `lib/dual-control.ts` |
| Config-format cross-version tolerance | `c1./c2.` dual-read; additive snapshot capture | `lib/config-crypto.ts`, `lib/config-snapshot.ts` |

The existing `setup/environments` staging → promote → rollback → known-good model versions **config snapshots,
not code**. The feature *extends the same shape to code releases*; it does not invent a new lifecycle.

## 4. Diff-first: every release is a signed delta

The product is already **diff-first, signed, and audited** — `config-diff` renders a content-free diff between
two config states, and `lib/signing.ts` signs content snapshots. A software update should feel the same: a
release is not an opaque new image, it is a **signed delta from its predecessor** that an admin reviews like a
pull request before promoting.

Two diffs compose:

- **Config/settings diff** — already exists (`config-diff`); extended to show the config-*schema* delta a
  release introduces (keys/validators added/removed/changed).
- **Release/code diff** — net-new: a **signed diff file** (the release-diff manifest) describing the **OCI layer
  delta** between the current and target image digests, plus the config-schema delta, the migrations, and the
  changelog. It is signed with the publisher's **private** key and verified on the instance with the matching
  **public** key (Ed25519, reusing `lib/signing.ts`), so a holder of the public key can prove the diff is
  authentic and unaltered *without* the publisher's secret. Container images are already content-addressable
  and layered, so a registry pull fetches *only changed layers* — the "copy container, digest-delta update" is
  realised by pinning to **digests** and letting the layer store dedup. The net-new value is making that delta
  **explicit, signed, visible, and coupled to the config migration** — not a new delta algorithm (OCI layer
  granularity is the practical delta unit; sub-layer bsdiff is out of scope).

The signature covers the **delta content itself** — the layer digests, the target image digest, the
config-schema delta and the migrations are all inside the signed payload — so tampering with *what the update
changes* (not just its metadata) breaks verification. The diff file is the signed unit; the image digests it
names are in turn content-addressed by the registry, so trust chains from *one published public key* down to
the exact bytes that will run.

Why this composes well here: the runtime image ships only the esbuild bundle + static SPA (no `node_modules`),
so the **app bundle is normally the one layer that changes** — deltas are naturally small *provided the build
is layer-stable* (unchanged deps → identical layer digests). A reproducible-build guard keeps that true.
Rollback is the **reverse delta to the known-good digest**, paired with the auto-backup, so code and config
roll back in lockstep — closing today's "downgrade is unguarded" gap.

## 5. The release descriptor (the contract)

A release is described by one signed object. The signature is over the **canonical JSON of every field except
`signature`** (same canonicalisation the provenance/audit anchors use), so trust is **per-delta**, not merely
per-image.

```ts
/** A single, signed software release — a delta from its predecessor that an admin reviews and promotes. */
interface ReleaseDescriptor {
  /** Semver of this release, e.g. "0.6.0". Human identity; NOT the trust anchor (the digest is). */
  version: string;
  /** Release channel — lets an org pin to a cadence. */
  channel: "stable" | "beta" | "edge";
  /** ISO-8601 build/publish time (informational; ordering is by digest chain, not clock). */
  releasedAt: string;

  /** The code, pinned by immutable DIGEST (never a mutable tag). */
  image: {
    ref: string;                 // registry ref, e.g. "ghcr.io/omniproject/omni-shell"
    digest: string;              // "sha256:…" — the content address that IS the code's identity
    predecessorDigest: string;   // the digest this release is a delta FROM (chains releases)
  };

  /** The DELTA — the heart of "copy container, digest-delta update". */
  delta: {
    layers: {
      digest: string;            // OCI layer digest
      sizeBytes: number;
      op: "add" | "replace" | "remove";
    }[];
    approxDownloadBytes: number; // sum of add/replace layers — the real cost of THIS update
  };

  /** Config compatibility + the migrations this release carries (both directions). */
  config: {
    /** Refuse to boot new code against a config schema older than this (fail closed, §10). */
    minConfigSchema: number;
    /** What settings the new code adds/removes/changes — drives the migration runner + the review diff. */
    schemaDelta: { added: string[]; removed: string[]; changed: string[] };
    /** Migration ids applied moving TO this release, and their inverses for a rollback FROM it. */
    migrations: { forward: string[]; backward: string[] };
  };

  /** Human-facing review material (rendered like a PR body in the update UI). */
  changelog: string;             // markdown
  notes?: string;

  /** Trust — the signed diff. Ed25519 over canonical(descriptor without `signature`), so the payload the
   *  signature covers INCLUDES image.digest, delta.layers, config.schemaDelta and config.migrations — the
   *  update's actual effect, not just its metadata. `publicKeyId` selects which trusted public key verifies
   *  it (see "Signing & key trust"). Per-delta, not per-image. */
  signature: {
    algorithm: "Ed25519";
    publicKeyId: string;         // which published public key verifies this diff
    value: string;               // base64
  };
}
```

### Signing & key trust

The diff file is signed with the publisher's **private** key and verified on every instance with the matching
**public** key before *anything* is staged (§10 fail closed). This reuses the gateway's existing Ed25519
primitive (`lib/signing.ts` — PEM public-key `verifySignature`), the same asymmetric mechanism that attests
the audit/provenance anchors, so no new crypto is introduced.

- **What is signed:** `canonical(ReleaseDescriptor without .signature)` — i.e. the whole diff, delta content
  included. Any edit to the layer delta, target digest, schema delta or migrations invalidates the signature.
- **Verification is against a *trusted* public key, never a key carried by the release.** A release names its
  `publicKeyId`; the instance resolves that id in its **update trust anchor** — a small set of pinned publisher
  public keys held in the sealed config (admin-managed, like `API_TOKENS`/role-map: fixed in code shape,
  data-configured). A `publicKeyId` the instance doesn't trust ⇒ **reject** (an update signed by an unknown key
  is never merely "unsigned" — it is refused).
- **Key rotation & revocation:** the trust anchor is a *set*, so a publisher can rotate signing keys by
  publishing the new public key into the anchor ahead of the release that uses it; a compromised key is dropped
  from the anchor and every release it signed stops verifying. This mirrors the key-registry's
  versioned/revocable model (`lib/key-registry.ts`).
- **Chain of trust to the running bytes:** the signature vouches for the diff → the diff pins `image.digest` and
  `delta.layers[].digest` → the registry is content-addressed, so those digests *are* the bytes. One trusted
  public key therefore anchors trust all the way down to what actually runs; there is no mutable tag anywhere in
  the path.
- **Non-repudiation + audit:** the verified `publicKeyId` + the diff's own hash are recorded on the tamper-evident
  audit chain at stage/promote, so "who signed the release an admin promoted, and exactly which delta" is
  provable after the fact.

An **update session** tracks one in-flight update; it is itself audited on the tamper-evident chain:

```ts
interface UpdateSession {
  id: string;
  release: ReleaseDescriptor;
  fromDigest: string;            // the digest we are updating FROM — the rollback target
  backupId: string;              // the auto sealed full-backup taken before staging
  knownGoodVersionId: string;    // the config-store version pinned as the rollback point
  phase:
    | "staged"        // verified + backed up; eval not yet started
    | "evaluating"    // eval container up, health pending
    | "eval-passed" | "eval-failed"
    | "promoting"     // maintenance lockdown engaged, agent swapping prod
    | "promoted"      // health-gated success
    | "rolled-back"   // auto or manual revert to fromDigest + backup
    | "failed";
  eval?: { instanceRef: string; health: "pending" | "green" | "red"; report: string };
  auditIds: string[];
}
```

## 6. The update flow

```
admin ─[step-up]→ POST /setup/update/stage { release: ReleaseDescriptor }
  1. verify signature + publicKeyId trust                         (fail closed if unverified)
  2. check image.predecessorDigest === current running digest     (deltas must chain)
  3. check config.minConfigSchema ≤ current config schema
  4. auto sealed full-backup  +  pin current config version known-good   (the rollback point)
  5. render the review diff: layer delta (size), config schemaDelta, changelog
        → admin reviews  →  UpdateSession { phase: "staged" }

(optional) POST /setup/update/eval
  6. deploy agent brings up an EVAL instance = a COPY of the current image + the delta layers,
     booted against a PORTABLE COPY of the sealed config (its own volume — the RWO PVC can't be shared)
  7. eval self-runs config.migrations.forward, then health/smoke; reports back
        → phase: "eval-passed" | "eval-failed"

admin ─[step-up + four-eyes]→ POST /setup/update/promote
  8. engage maintenance lockdown (writes → 503; §ops)
  9. deploy agent swaps the prod image to release.image.digest (orchestrator restart)
 10. new prod boots against the SAME sealed config, runs migrations.forward, health-gates
 11. green  → release lockdown, phase: "promoted", record on the audit chain
     red    → auto-rollback: agent reverts to fromDigest, restore backupId,
              run migrations.backward, release lockdown, phase: "rolled-back"
```

Everything except the two deploy-agent hops (eval bring-up, prod swap) and the signature/migration pieces is
assembled from existing primitives (§3).

## 7. Config compatibility contract + migration runner (the subtle part)

Today's cross-version handling is **forward-lenient but unguarded on downgrade**: additive snapshot capture +
`c1./c2.` dual-read mean old config opens on new code, but a newer config carrying keys the *older* code
doesn't know are silently dropped, and there is **no migration runner**. A code-swap-with-rollback cannot rely
on best-effort.

The contract:

- **`configSchema` is a monotonic integer** stamped into the config store. A release declares `minConfigSchema`
  and (via `schemaDelta`/`migrations`) the schema it produces.
- **Forward migration is mandatory and explicit.** New code runs `migrations.forward` against the loaded config
  before serving; a missing/failed migration **fails closed** (refuse to serve — never run on half-migrated
  config), consistent with `ConfigDecryptError` refusing to clobber unreadable ciphertext (§10).
- **Rollback is symmetric.** Because a release is a delta with `migrations.backward`, a rollback runs the inverse
  and restores the paired backup — code and config never diverge.
- **Downgrade past `minConfigSchema` is refused**, not attempted best-effort.

This is the net-new design work; the rest is orchestration.

## 8. Deployment-target matrix — who performs the swap

The gateway coordinates; the *actor that swaps code* is target-specific. The feature must name which it targets:

| Target | Who swaps the container | Eval-before-prod | Notes |
| --- | --- | --- | --- |
| **Self-host compose** | a deploy-agent sidecar with a **scoped** Docker socket, on the gateway's signal | a second compose service off a portable config copy | simplest agent; socket scope is the blast-radius question |
| **k8s / Helm** | a k8s **Job/operator** the gateway triggers; `helm upgrade`/image-digest patch | a Job pod off a cloned config volume (RWO PVC ⇒ its own copy) | `Recreate` strategy today; blue/green needs a second volume |
| **External CD** | the gateway only **signals**; CD (Argo/Flux/pipeline) does the swap | CD's own preview/canary | least gateway power, safest; recommended default |
| **Managed control plane** | the control plane | control-plane staging | *does not exist today* — there is no managed-vs-self-host flag in code |

## 9. Security posture

Replacing code is the **highest-risk action in the system**, so it takes the strongest gates the codebase has:

- **admin + `requireStepUp`** on stage and promote (note: the existing env promote/rollback are admin-only
  *without* step-up — a gap this feature closes for the code path).
- **four-eyes** on promote: register a `software.promote` executor in `lib/dual-control.ts` (the pattern already
  gates `maintenance.engage`, `role_map.update`, `key.revoke`).
- **signed release**: the descriptor's Ed25519 signature is verified before anything is staged; an unverified or
  untrusted `publicKeyId` fails closed.
- **maintenance lockdown** during the swap window, so no write lands on a half-swapped instance.
- **immutable audit**: every stage/eval/promote/rollback is recorded on the tamper-evident audit chain — "who
  promoted which digest-delta, when, having reviewed diff X."
- **key continuity is mandatory**: the swap must preserve `SESSION_SECRET`, the config key (`CONFIG_KEY_RAW`/KMS),
  the vault root, the IRK, and the audit-chain head — or the instance comes up blank/opaque by design.

## 10. Phasing

- **Phase 0 — spec.** The release descriptor (§5), the signature format, the config compatibility contract +
  migration runner (§7). This is the real design work; the rest is orchestration.
- **Phase 1 — safety rails (no code swap).** Auto-backup-before-update, known-good rollback point, config-diff
  preview, the migration runner, maintenance-lockdown-during-update. All in-process; works on *every*
  deployment; delivers "safe update" even where the swap stays manual.
- **Phase 2 — self-host swap.** A compose deploy-agent (scoped socket) that performs the image-digest swap on
  signal, with health-gated auto-rollback.
- **Phase 3 — eval / blue-green.** Bring up an eval instance = copy of current image + delta, off a portable
  config copy; health-gate promotion. On k8s this is a Job/operator; the RWO-PVC constraint means eval gets its
  own config copy.
- **Phase 4 — managed channel** (only if a managed deployment mode ever exists).

**Recommendation:** ship **Phase 0 + Phase 1** first. They make updates genuinely safer on every deployment,
reuse what exists, and don't depend on resolving the orchestration fork. Phases 2–3 then slot the swap/eval in
per target.

## 11. Open questions (decisions that shape the build)

1. **First target** — self-host compose, k8s/Helm, or external-CD-signal? Picks the Phase-2 shape.
2. **Gateway reach** — strictly *signal an external CD* (safest, least power) vs *drive an agent with a scoped
   Docker socket* (more self-contained, more blast radius)?
3. **Is eval-before-prod mandatory or optional** per paranoia tier? (Most complex phase; optional lets 0–1 ship
   first.)
4. **Release trust model + anchor bootstrap** — the diff is verified against a pinned publisher public key in the
   instance's update trust anchor. The open question is *how the first key gets there*: shipped as a bundled
   trust root in the image (convenient, but couples key rotation to releases), admin-pinned on setup (stronger,
   more operator burden), or verified against an external attestation (e.g. sigstore/registry). And: one
   publisher key, or an org-supplied key so a customer can re-sign/vet releases themselves?
5. **Downgrade policy** — support rolling *code* back onto a newer config (the unguarded direction, gated by
   `minConfigSchema` + `migrations.backward`), or always "restore the paired backup + old digest" (simpler,
   safer)?

---

*This is a proposal. If a decision here proves wrong for a case, change it explicitly in review rather than
working around it (per the DESIGN-PRINCIPLES closing note).*
