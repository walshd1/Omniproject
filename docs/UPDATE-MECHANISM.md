# Update mechanism — immutable, signed, blue-green with promote-by-digest

**Status:** design note (spec). How a new version of OmniProject is built, verified, tested by an
org, and promoted to production — without ever mutating a running deployment in place, and without
the code that ships differing by a single byte from the code that was tested and approved.

## 0. Principles

1. **Data ⟂ code.** Data is persistent and backed up; code is an immutable, content-addressed
   container image. An update replaces the *code*, never the *data*.
2. **Immutable deploys.** A new version is a new container, never an in-place patch of a running one.
3. **Signed + checksummed.** Every image is signed with a private release key and carries a checksum
   (digest). Nothing runs until its signature verifies against the trusted public key and its digest
   matches.
4. **Promote by digest.** The image an org tests is promoted to production *by its digest* — the same
   bytes, never a rebuild. What was approved is what runs.
5. **Approval-gated promotion.** Copy-to-prod is a security-relevant act and runs through the
   platform's existing approval-chain / dual-control (a human passkey sign-off), consistent with the
   governing invariant: *no lone insider reduces posture without a signed sign-off.*
6. **Instant rollback.** Because prod is just "which signed digest is live," rollback is repointing to
   the previous digest; data rollback is restoring the pre-update backup.

## 1. Separation of data and code

Code and data already live on opposite sides of a hard line, which is what makes immutable,
swap-the-container updates safe:

- **Code** = the built container image (the api-server bundle + the SPA app-shell). Deterministic
  from a git commit; content-addressed by digest.
- **Data** = everything an org owns, none of it baked into the image:
  - the **sealed config store** (`config-crypto.ts` — encrypted at rest; org/programme/project/user
    config defs, rules, grants, chains),
  - **artifacts** (`artifact-store.ts` — dashboards, screens, forms, reports as scoped defs),
  - **security state** (`security-state.ts` — the sealed, fleet-converged autonomous grants / AI authz),
  - **project data**, which is never stored by the app at all (the stateless / zero-at-rest posture —
    it lives in the broker-backed systems of record).

An update carries the code across; the data volume (or the external store) stays put and is attached
to the new container.

## 2. Lifecycle

```
 build ──► sign ──► publish ──► [auto-backup] ──► spawn TEST container ──► org tests
   │         │         │              │                   │                     │
 commit   private   registry     snapshot data     new digest, org's         approve
  →image   key +     (by digest)  (pre-update)      data (copy/snapshot)      (passkey
           checksum                                  attached, isolated        sign-off)
                                                      writes)                     │
                                                                                  ▼
                                          verify sig+digest ◄── promote-by-DIGEST ┘
                                                  │
                                                  ▼
                                         run in PROD (swap container)
                                                  │
                                        rollback = repoint to previous digest
```

1. **Build** — a release build from a pinned commit produces the image. Reproducible where possible so
   the digest is a function of the source.
2. **Sign** — the image is signed with the **private release key**; the **digest** (checksum) is
   recorded. (Signing lives outside the app's mutation path — a build/release control.)
3. **Publish** — pushed to the registry, addressable **by digest** (`@sha256:…`), never by a mutable
   tag for the purposes of promotion.
4. **Auto-backup** — before an org adopts a new version, its data is snapshotted (see §6). Automatic,
   not a manual step.
5. **Spawn test container** — the new digest runs as a per-org **staging/canary** instance, attached to
   a **copy/snapshot** of that org's data with **isolated writes** (§5). This step is *optional* and
   *persists only while the org is testing*.
6. **Approve** — when the org is happy, an authorized human **passkey-signs** the promotion (§7).
7. **Promote by digest** — the **exact tested digest** is repointed to production (§3). No rebuild.
8. **Verify + run** — the runtime verifies signature + digest before boot (§4); on success the new
   container takes over; on failure it refuses to start (fail-closed).
9. **Rollback** — repoint prod to the previous signed digest; restore data from the §6 backup if a
   migration touched it.

## 3. Promote by digest (the core rule)

Promotion moves an **image digest**, not a tag and not a source ref:

- The org tests digest `D`. Approval records `D`. Promotion sets production to `D`. There is **no build
  between test and prod** — the tested bytes are the shipped bytes.
- A mutable tag (`:latest`, `:stable`) may *point at* `D` for humans, but the promotion record and the
  admission check are always the digest. A tag being re-pointed can never substitute a different image.
- The digest is the join key across the whole flow: backup metadata, the approval proposal, the
  admission verification, and the rollback pointer all reference the same `D`.

This closes the classic gap where "tested `:v2`" and "deployed `:v2`" are different bytes because the
tag was rebuilt.

## 4. Signing + checksum

- **Trust root.** A release **private key** signs images; the corresponding **public key** is baked
  into the runtime / deployment trust store (image entrypoint or the cluster admission controller). The
  private key never ships.
- **Verification point.** Signature + digest are verified **before the container is allowed to run** —
  ideally at admission (k8s admission controller / policy) *and* defensively at the image entrypoint,
  so an unsigned or tampered image fails closed in both a managed and a bare-container deploy.
- **What to reuse.** The app already has public-key verification patterns to model the runtime check on:
  `lib/signing.ts` (server signing), `lib/license.ts` (public-key license verification),
  `lib/hmac-chain.ts` (tamper-evident hash chaining for the audit trail of promotions).
- **Checksum = the digest.** The image content digest (`sha256`) is the checksum; there is no separate
  bespoke checksum to keep in sync.

## 5. Test isolation (the "optionally persists for orgs to test" step)

The test container must never be able to corrupt prod data:

- It attaches a **point-in-time snapshot/copy** of the org's data (from §6), not the live store.
- Its **writes are isolated** to that copy and **discarded on reject**; only a *promotion* (§7) makes
  anything durable, and even then prod runs against prod data, not the test copy.
- It is **ephemeral by default** — it exists while the org evaluates and is torn down on
  accept-and-promote or on reject. "Optionally persists" = the org chooses how long the canary lives.

## 6. Backup + rollback

- **Auto-backup before adopt.** A pre-update snapshot of the sealed config store + artifacts +
  security state (`snapshot.ts`, `def-store-export`, `zip.ts`), sealed at rest (`config-crypto.ts`).
- **Rollback = two independent moves:** repoint prod to the previous signed **digest** (code), and — only
  if the update ran a data migration — **restore** the pre-update backup (data). Because code rollback is
  just a pointer change, it is near-instant and independent of the data question.

## 7. Promotion is approval-gated

Copy-to-prod reduces nothing on its own, but *shipping new code* is a posture change, so it inherits
the platform's control model rather than being an unguarded button:

- Promotion of digest `D` is raised as an **approval proposal** (`approval-chain.ts` /
  `approval-service.ts`) carrying `D` as its parameter (params only, never code).
- It requires a **human passkey sign-off** (dual-control where ≥2 admins exist; the single-admin
  degrade — one admin *confirms + signs* — where they don't). Every promotion is therefore
  non-repudiable and written to the hash-chained audit log.
- No autonomous/agentic actor can promote — promotion is a hard human-only action, matching the
  "grant AI authority is human-only" discipline in [WORKFLOW-APPROVAL-CHAINS.md](design/WORKFLOW-APPROVAL-CHAINS.md) §0.

## 8. Data-shape compatibility contract

Data outlives code, so **new code must read old data**:

- **Forward-only, additive.** A new version reads the previous version's persisted shapes. New fields
  are optional with safe defaults; nothing is required that old data can't supply.
- **Unknown-key tolerance already holds.** The settings/def validators ignore unknown keys (they are
  registry-driven, not `additionalProperties:false`), so a *rollback* to older code that doesn't know a
  new field is load-safe too — the field is simply ignored, not rejected.
- **Migrations, when unavoidable, are an explicit signed step** run against the attached data *after*
  verification and *before* serving traffic, and are themselves reversible or backed by the §6 snapshot.
  A migration that can't be made forward/backward safe blocks promotion rather than shipping silently.

## 9. Reuse map

| Need | Existing anchor |
| --- | --- |
| Sealed data at rest | `lib/config-crypto.ts`, `lib/security-state.ts` |
| Backup / export / snapshot | `lib/snapshot.ts`, `def-store-export`, `lib/zip.ts` |
| Public-key verification pattern | `lib/license.ts`, `lib/signing.ts` |
| Tamper-evident promotion audit | `lib/hmac-chain.ts` (hash-chained audit) |
| Approval-gated promotion | `lib/approval-chain.ts`, `lib/approval-service.ts`, `lib/approval-gate.ts` |
| Immutable deploy targets | `k8s-enterprise-manifest.yaml` (+ `-ha`), `deploy/helm`, `deploy/railway` |
| Stateless / zero-at-rest data⟂code line | `public/sw.js` (app-shell only), broker-backed project data |

## 10. Open questions

- **Signing toolchain.** Cosign/sigstore (keyless OIDC or key-pair) vs. a bespoke `signing.ts`-style
  detached signature over the digest. Cosign + an admission policy is the least-custom path.
- **Where the public key lives per deploy target.** k8s admission policy vs. entrypoint-embedded vs. both.
- **Migration runner.** Where signed migrations execute (init container / entrypoint step) and how their
  reversibility is proven before promotion.
- **Multi-tenant test canaries.** One canary per org vs. a shared canary with per-org data copies, and
  who pays for the canary's lifetime.
- **Registry retention.** How many previous signed digests are kept for rollback, and the GC policy.

## 11. Build phases

1. **Sign + verify at boot.** Sign the release image by digest; verify signature + digest at the
   entrypoint (fail-closed). *No workflow change yet — just provenance.* **— BUILT.**
   `lib/release-provenance.ts` verifies a signed `ReleaseManifest` (version / gitSha / digest) against
   a trusted release public key (`RELEASE_PUBLIC_KEY`) at boot; `RELEASE_VERIFY` gates enforcement
   (`off` default / `warn` / `strict` = refuse to boot an unattested or tampered build). The release side
   signs via `src/tools/sign-release.ts` with the release private key (never shipped). Reuses the existing
   Ed25519 `lib/signing` verify path. CI wiring (produce + bake the signed manifest) is intentionally
   deferred to a workflow change.
2. **Promote-by-digest record + admission check.** Promotion sets prod to a digest; admission verifies
   it. Mutable tags become human-facing aliases only. **— BUILT.** A signed `PromotionRecord` names the
   approved digest (`sign-promotion` tool). `admitBuild(manifest, promotion, key)` admits a build only when
   both signatures verify AND the build's digest equals the promoted digest (fail-closed). At boot,
   `verifyReleaseProvenance` also enforces `RELEASE_EXPECTED_DIGEST` — the running build's digest must match
   the environment's approved digest, so a same-tag rebuild is refused. The k8s admission-policy / entrypoint
   wiring that calls `admitBuild` is deferred to a deploy change.
3. **Approval-gated promotion.** Wire promotion through the approval-chain (passkey sign-off), audited.
4. **Auto-backup + restore.** Pre-adopt snapshot; one-command restore bound to a digest rollback.
5. **Per-org test canary.** Spawn the new digest against an isolated data copy; tear down on
   accept/reject.
6. **Signed migration runner.** Only if/when a release needs a data-shape change that isn't forward-safe.
