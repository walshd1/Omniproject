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
- **Container-image CVE scan.** The `docker-image` CI job scans the built `omni-shell` image with
  **Trivy** and **blocks on fixable HIGH/CRITICAL** vulnerabilities (`--severity HIGH,CRITICAL
  --ignore-unfixed --exit-code 1`) — so a base-image or OS-package CVE with an available fix fails the
  build, while unfixable base noise is reported but non-blocking. Trivy is installed **checksum-verified**
  via `scripts/ci/fetch-verified.sh` (no unpinned third-party action, no `curl|sh`), and pulls its vuln
  DB from ghcr.io. This complements the dependency (`pnpm audit`) and SBOM steps by covering the OS layer
  the lockfile can't see.
- **Static analysis (SAST).** **CodeQL** (`security-extended` query pack) runs in
  `.github/workflows/codeql.yml`, and a repo-local **semgrep taint-scan** (`taint-scan` job in
  `.github/workflows/ci.yml` + `.semgrep/omniproject.yml`) gives an advisory second opinion.
- **Secret scanning.** A blocking **gitleaks** scan runs as the `secret-scan` job in
  `.github/workflows/ci.yml`, tuned via `.gitleaks.toml` to allowlist known test fixtures while
  blocking real new secrets.
- **Automated dependency updates.** Dependabot is configured (`.github/dependabot.yml`).
- **Published image on GHCR + attestation against the pushed digest.** On a version tag,
  `.github/workflows/release.yml` builds the `omni-shell` image, **pushes it to GHCR**
  (`ghcr.io/<owner>/<repo>:<tag>`, `packages: write`), and binds a **SLSA build-provenance** attestation
  and an **SBOM attestation** (`actions/attest-build-provenance@v4` + `actions/attest-sbom@v4`, keyless
  via Sigstore/GitHub OIDC — no long-lived signing key) to the **pushed registry manifest digest** (also
  stored in the registry as OCI referrers via `push-to-registry`). A consumer can then verify the exact
  image they pulled:

  ```sh
  gh attestation verify oci://ghcr.io/<owner>/<repo>:<tag> --owner <owner>
  ```

  The image remains source-buildable from the same `Dockerfile`; the published image is an additive,
  independently verifiable artifact. The CycloneDX SBOM is also attached to the GitHub Release.
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

1. **Hosted image publish + registry attestation — DONE** (see "in place today"). `release.yml` now
   pushes `omni-shell` to GHCR on a version tag and binds keyless SLSA build-provenance + SBOM
   attestations to the **pushed registry digest** (`packages: write` granted, `push-to-registry` stores
   the attestations as OCI referrers), so `gh attestation verify oci://ghcr.io/<owner>/<repo>:<tag>`
   works against the exact pulled image. A separate bare `cosign sign` is **not** needed: the keyless
   Sigstore attestation against the pushed digest already provides the consumer-verifiable signature,
   and it carries provenance a bare signature does not. (GitHub's native **secret scanning** +
   **push protection**, enabled in repo settings, remains a zero-config complement worth turning on.)
2. **Signed release tags.** Tagging `0.7.0` with a GPG/SSH-signed tag — pairs with the
   maintainer-driven release in [`RELEASE-NOTES-0.7.0-DRAFT.md`](./archive/releases/RELEASE-NOTES-0.7.0-DRAFT.md).

See [`PARKED-DECISIONS.md`](./PARKED-DECISIONS.md) for the full list of items awaiting a decision.
