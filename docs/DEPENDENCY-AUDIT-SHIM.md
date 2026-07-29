# Dependency-audit shim (temporary)

**Status:** temporary workaround. Remove it once the upstream bug below is fixed (see *How to tell it's safe to
revert*). Introduced 2026-07 (PR that added `scripts/ci/audit-advisories.mjs`).

## What we did

CI's `dependency-scan` gate no longer runs `pnpm audit --audit-level high` directly. It runs
[`scripts/ci/audit-advisories.mjs`](../scripts/ci/audit-advisories.mjs) instead. The script:

- flattens the installed workspace tree (`pnpm ls -r --depth Infinity`) into `name → versions`;
- POSTs that set to npm's bulk advisory endpoint
  (`https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`);
- **decompresses the response itself** (gunzip when the body starts with the gzip magic bytes `0x1f 0x8b`);
- **blocks the build** on any `high`/`critical` advisory whose `vulnerable_versions` range matches an installed
  version (`semver.satisfies`), and **fails closed** on any error (network / non-2xx / parse).

Semantics match `pnpm audit --audit-level high`; `semver` is installed into a throwaway `NODE_PATH` so the
workspace tree and lockfile are untouched.

## Why (the upstream bug)

npm's bulk advisory endpoint returns a **gzip-compressed body without a `Content-Encoding: gzip` response
header**. Because the header is absent, no HTTP client auto-decompresses it:

- `pnpm audit` dies with `ERR_PNPM_AUDIT_BAD_RESPONSE` → *"Unexpected token … is not valid JSON"* — on **every**
  pnpm version tested (`11.8.0` and latest `11.17.0`), and on both GitHub-hosted runners and locally, so it is
  **not** our environment and **not** a pnpm-version regression a bump fixes.
- Node's global `fetch` (undici) fails identically (it, too, only decompresses when the header is present).
- `curl --compressed` **succeeds** (HTTP 200 + valid JSON) — proof the endpoint is **up** and the payload is
  valid gzip. The defect is purely the missing response header.

This is an npm/CDN-side issue. We do not control it, and it is expected to be fixed upstream eventually.

## Why not the alternatives

- **Skip/allow the audit on failure** (an earlier "tolerate an outage" change, since reverted): because the
  failure is *persistent*, warn-and-pass would leave the high/critical gate **effectively disabled**
  indefinitely — a real security weakening. Rejected.
- **Bump / unpin pnpm:** latest `11.17.0` fails identically. Doesn't help.
- **Dependabot:** has no fix, and does not manage the pnpm CLI anyway.

## How to tell it's safe to revert

The shim can be removed the moment the upstream client-decode path works again. Test it directly:

```bash
# 1) Does a plain client now decode the response? (No manual gunzip.)
#    Prints valid JSON  → upstream fixed (Content-Encoding header present, or endpoint no longer gzips).
#    Prints gzip/garbage or throws → still broken; keep the shim.
node -e 'fetch("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",{method:"POST",\
  headers:{"content-type":"application/json"},body:JSON.stringify({lodash:["4.17.11"]})})\
  .then(r=>r.json()).then(j=>console.log("DECODED OK:",Object.keys(j))).catch(e=>console.log("STILL BROKEN:",e.message))'

# 2) Confirm pnpm itself is happy again (the real acceptance test):
pnpm audit --audit-level high    # exit 0 / a normal advisory report, NOT ERR_PNPM_AUDIT_BAD_RESPONSE
```

When **both** pass, revert this shim: restore the `Audit (block on high or critical)` step in
`.github/workflows/ci.yml` to `run: pnpm audit --audit-level high`, and delete
`scripts/ci/audit-advisories.mjs` + this file.

A quick way to keep this on the radar: run test (1) periodically (e.g. a monthly reminder), or watch for the
npm status/registry changelog noting the advisory-endpoint content-encoding fix.
