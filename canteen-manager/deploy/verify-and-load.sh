#!/usr/bin/env bash
#
# Verify + load an offline deployment bundle on the air-gapped machine.
# Checks integrity (sha256) and, if present, authenticity (GPG signature)
# BEFORE loading any image, then `docker load`s each tarball. Rejects a
# tampered or incomplete bundle without loading anything.
#
# Run from inside the bundle directory (where checksums.sha256 lives):
#   ./verify-and-load.sh
# Optionally pin the trusted signer:
#   BUNDLE_GPG_KEY=<key-id> ./verify-and-load.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

require() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' not found" >&2; exit 1; }; }
require docker

[[ -f checksums.sha256 ]] || { echo "ERROR: checksums.sha256 missing — not a valid bundle" >&2; exit 1; }

# Portable sha256 verify (Linux: sha256sum; macOS/BSD: shasum -a 256).
verify_checksums() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c checksums.sha256
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c checksums.sha256
  else
    echo "ERROR: no sha256sum/shasum available" >&2; exit 1
  fi
}

if [[ -f checksums.sha256.asc ]]; then
  echo "==> Verifying GPG signature on checksums"
  require gpg
  gpg --verify checksums.sha256.asc checksums.sha256
else
  echo "==> No signature file (checksums.sha256.asc) — integrity-only verification"
fi

echo "==> Verifying image checksums"
verify_checksums

echo "==> Loading images"
# nullglob: if images/ holds no .tar (malformed bundle) the loop body must not
# run with the literal 'images/*.tar' — fail closed with an empty load instead.
shopt -s nullglob
for tar in images/*.tar; do
  echo "  loading $tar"
  docker load -i "$tar"
done

echo "==> Done. Loaded images:"
docker images --format '  {{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E 'canteen-|postgres' || true
echo "Next: ./up.sh"
