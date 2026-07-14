# Software supply-chain security

What OmniProject's build produces and verifies for supply-chain assurance, and the decisions still
open (parked for the maintainer). Companion to [`COMPLIANCE.md`](./COMPLIANCE.md) (control mapping)
and [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md).

## In place today (CI)

- **CycloneDX component SBOM.** The `dependency-scan` job generates a full **CycloneDX** SBOM
  (components + versions, suitable for CVE correlation) with **Syft**, uploaded as the
  `sbom-cyclonedx.json` build artefact. This is the SBOM format procurement and US EO 14028 ask for.
- **Licence SBOM.** A licence inventory (`pnpm licenses list`) is uploaded as `sbom-licences`, so a
  reviewer can confirm there are no incompatible/against-policy licences.
- **Dependency advisories.** `pnpm audit` **blocks on high or critical** (`--audit-level high`) and
  reports all lower severities.
- **Static analysis (SAST).** **CodeQL** (`security-extended` query pack) runs in
  `.github/workflows/codeql.yml`, and a repo-local **semgrep taint-scan** (`taint-scan` job in
  `.github/workflows/ci.yml` + `.semgrep/omniproject.yml`) gives an advisory second opinion.
- **Secret scanning.** A blocking **gitleaks** scan runs as the `secret-scan` job in
  `.github/workflows/ci.yml`, tuned via `.gitleaks.toml` to allowlist known test fixtures while
  blocking real new secrets.
- **Automated dependency updates.** Dependabot is configured (`.github/dependabot.yml`).
- **Release build provenance + SBOM attestation.** On a version tag, `.github/workflows/release.yml`
  produces a cryptographically verifiable **SLSA build-provenance** attestation and an **SBOM
  attestation** (`actions/attest-build-provenance@v1` + `actions/attest-sbom@v1`, keyless via
  Sigstore/GitHub OIDC — no long-lived signing key), verifiable with `gh attestation verify`.
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

1. **Hosted image publish + registry signing (GHCR / cosign).** Build-provenance and SBOM
   attestation already ship for the release artifact (see "in place today"); what remains is a
   decision to **publish the image** to a registry (e.g. GHCR) and sign the pushed image — this
   requires (a) the registry + publish intent, (b) the repo's `packages: write` permission, and
   (c) a signing-identity policy (keyless OIDC vs a managed key). The `release.yml` GHCR block is
   staged (commented) for when that decision is made: push to GHCR → `cosign sign` (keyless) →
   re-attest provenance against the pushed digest. (GitHub's native **secret scanning** +
   **push protection**, enabled in repo settings, is a zero-config complement worth turning on
   regardless.)
2. **Signed release tags.** Tagging `0.7.0` with a GPG/SSH-signed tag — pairs with the
   maintainer-driven release in [`RELEASE-NOTES-0.7.0-DRAFT.md`](./archive/releases/RELEASE-NOTES-0.7.0-DRAFT.md).

See [`PARKED-DECISIONS.md`](./PARKED-DECISIONS.md) for the full list of items awaiting a decision.
