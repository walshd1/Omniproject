# Software supply-chain security

What OmniProject's build produces and verifies for supply-chain assurance, and the decisions still
open (parked for the maintainer). Companion to [`COMPLIANCE.md`](./COMPLIANCE.md) (control mapping)
and [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md).

## In place today (CI)

- **CycloneDX component SBOM.** The `dependency-scan` job generates a full **CycloneDX** SBOM
  (components + versions, suitable for CVE correlation) with **Syft**, uploaded as the
  `sbom-cyclonedx.json` build artefact. This is the SBOM format procurement and US EO 14028 ask for.
- **Licence SBOM.** A licence inventory (`pnpm licenses list`) is uploaded as `sbom-licences`, so a
  reviewer can confirm there are no incompatible/again-st-policy licences.
- **Dependency advisories.** `pnpm audit` **blocks on CRITICAL** and reports all lower severities.
- **Automated dependency updates.** Dependabot is configured (`.github/dependabot.yml`).
- **Pinned base + reproducible install.** The image pins its base tag and CI installs against the
  committed lockfile (`--frozen-lockfile`); the broker images in compose are pinned (enforced by the
  compose guard).
- **Vulnerability disclosure.** `SECURITY.md` provides a responsible-disclosure path.

## Consuming the SBOM

Download the `sbom-cyclonedx.json` artefact from a CI run and feed it to your scanner, e.g.:

```sh
grype sbom:sbom-cyclonedx.json        # vulnerabilities
# or import into Dependency-Track / your SCA platform for continuous monitoring
```

## Parked — needs a maintainer decision

These close the remaining supply-chain gaps but require infrastructure/policy choices, so they're
left for review rather than guessed at:

1. **Container image signing + provenance (cosign / SLSA).** Keyless **cosign** signing and **SLSA
   build provenance** attestation are the next step, but they require: (a) a decision to **publish
   the image** to a registry (e.g. GHCR), (b) the repo's `packages: write` + `id-token: write`
   permissions, and (c) a signing-identity policy (keyless OIDC vs a managed key). Once you confirm
   the registry + publish intent, this is a small CI addition: push to GHCR → `cosign sign` (keyless)
   → `cosign attest` the SBOM + SLSA provenance.
2. **Secret-scanning gate (gitleaks).** A blocking secret scan is valuable, but the repo deliberately
   contains **test fixtures** that look like secrets (`loadtest-not-a-secret`, `ci-dummy`,
   `dev-only-insecure-…`, demo tokens). A gitleaks gate needs a tuned `.gitleaks.toml` allowlist for
   those so it blocks **real** new secrets without false-positiving the fixtures — best done in one
   watched iteration. (GitHub's native **secret scanning** + **push protection**, enabled in repo
   settings, is a zero-config complement worth turning on regardless.)
3. **Signed release tags.** Tagging `0.7.0` with a GPG/SSH-signed tag — pairs with the
   maintainer-driven release in [`RELEASE-NOTES-0.7.0-DRAFT.md`](./archive/releases/RELEASE-NOTES-0.7.0-DRAFT.md).

See [`PARKED-DECISIONS.md`](./PARKED-DECISIONS.md) for the full list of items awaiting a decision.
