#!/usr/bin/env bash
#
# fetch-verified.sh — download a release artifact and verify its integrity BEFORE it is used.
#
# Hardens the "curl -sSL <url> | tar xz" anti-pattern: piping an unverified download straight into
# tar runs whatever bytes the network returned, so a compromised release, a poisoned CDN edge, or an
# in-path attacker gets arbitrary code execution inside CI. This script downloads to a file first,
# checks its SHA-256, and only extracts on a match — fail-closed at every step.
#
# Usage:
#   fetch-verified.sh --url URL --out FILE [--sha256 HEX] [--checksums-url URL] [--checksums-name NAME]
#
# Verification precedence (strongest first; the script refuses to proceed if none applies):
#   1. --sha256 HEX  — a 64-hex digest PINNED IN THIS REPO. This is the real supply-chain anchor:
#      an immutable value committed out-of-band, so a tampered release cannot also rewrite the pin.
#      The artifact MUST match it exactly.
#   2. --checksums-url — the release's OWN published checksums file. This catches corruption,
#      truncation, and any tamper that did not also rewrite that file, but it is fetched from the
#      same origin as the artifact, so it is NOT a substitute for a pinned digest. Used only when no
#      pin is set; the script prints a loud warning and echoes the observed digest so a maintainer
#      can promote it to a pin (mode 1).
#
# Whatever the mode, the script prints the artifact's actual SHA-256 so pins can be captured.
set -euo pipefail

URL="" OUT="" SHA256="" CHECKSUMS_URL="" CHECKSUMS_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --sha256) SHA256="$2"; shift 2 ;;
    --checksums-url) CHECKSUMS_URL="$2"; shift 2 ;;
    --checksums-name) CHECKSUMS_NAME="$2"; shift 2 ;;
    *) echo "fetch-verified: unknown arg $1" >&2; exit 2 ;;
  esac
done

if [ -z "$URL" ] || [ -z "$OUT" ]; then
  echo "fetch-verified: --url and --out are required" >&2
  exit 2
fi

# Download to the target file (never straight to a pipe). -f fails on HTTP errors so a 404/403 page
# is not silently treated as a valid artifact.
echo "fetch-verified: downloading $URL"
curl -fsSL "$URL" -o "$OUT"

ACTUAL="$(sha256sum "$OUT" | awk '{print $1}')"
echo "fetch-verified: sha256($OUT) = $ACTUAL"

if [ -n "$SHA256" ]; then
  # Mode 1 — pinned digest (strong).
  if [ "$ACTUAL" != "$SHA256" ]; then
    echo "fetch-verified: DIGEST MISMATCH — expected $SHA256, got $ACTUAL" >&2
    echo "fetch-verified: refusing to use a tampered/wrong artifact." >&2
    rm -f "$OUT"
    exit 1
  fi
  echo "fetch-verified: OK — matches the repo-pinned SHA-256."
elif [ -n "$CHECKSUMS_URL" ]; then
  # Mode 2 — verify against the release's own checksums file (corruption guard, not a pin).
  echo "fetch-verified: WARNING — no repo-pinned --sha256; falling back to the release checksums file." >&2
  echo "fetch-verified: pin '$ACTUAL' via --sha256 for full supply-chain protection." >&2
  sums="$(mktemp)"
  curl -fsSL "$CHECKSUMS_URL" -o "$sums"
  name="${CHECKSUMS_NAME:-$(basename "$URL")}"
  # The checksums file lists "<sha256>  <filename>"; assert our artifact's line matches our digest.
  expected="$(awk -v n="$name" '$2 == n || $2 == "*"n {print $1}' "$sums" | head -n1)"
  rm -f "$sums"
  if [ -z "$expected" ]; then
    echo "fetch-verified: could not find '$name' in the checksums file." >&2
    rm -f "$OUT"
    exit 1
  fi
  if [ "$ACTUAL" != "$expected" ]; then
    echo "fetch-verified: CHECKSUM MISMATCH — release lists $expected, got $ACTUAL" >&2
    rm -f "$OUT"
    exit 1
  fi
  echo "fetch-verified: OK — matches the release-published checksum for $name."
else
  echo "fetch-verified: no --sha256 pin and no --checksums-url — nothing to verify against; refusing." >&2
  rm -f "$OUT"
  exit 1
fi
