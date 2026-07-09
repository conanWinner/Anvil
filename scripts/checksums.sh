#!/usr/bin/env bash
# scripts/checksums.sh
# Generate SHA256 checksums for release binaries

set -euo pipefail

DIST_DIR="${1:-dist/binaries}"
CHECKSUM_FILE="$DIST_DIR/checksums.txt"

# Expected binaries
EXPECTED_BINARIES=(
  "anvil-darwin-arm64"
  "anvil-darwin-x64"
  "anvil-linux-arm64"
  "anvil-linux-x64"
)

echo "Generating checksums for binaries in $DIST_DIR"

cd "$DIST_DIR"

# Verify at least one binary exists
if ! ls anvil-* 1>/dev/null 2>&1; then
  echo "ERROR: No anvil-* binaries found in $DIST_DIR"
  echo "Expected files: ${EXPECTED_BINARIES[*]}"
  exit 1
fi

# Verify all expected binaries exist
missing=()
for binary in "${EXPECTED_BINARIES[@]}"; do
  if [ ! -f "$binary" ]; then
    missing+=("$binary")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "ERROR: Missing expected binaries: ${missing[*]}"
  echo "Found binaries:"
  ls -la anvil-* 2>/dev/null || echo "  (none)"
  exit 1
fi

# Generate checksums
shasum -a 256 anvil-* > checksums.txt

echo "Checksums written to $CHECKSUM_FILE:"
cat checksums.txt
