#!/bin/bash
# Builds standalone binaries for all platforms using bun build --compile

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
cd "$CLI_DIR"

VERSION=$(node -p "require('./package.json').version")
OUTDIR="dist/binaries"
mkdir -p "$OUTDIR"

for target in bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64; do
  platform=$(echo "$target" | sed 's/bun-//' | tr '-' '/')
  echo "Building for $target..."
  bun build src/index.ts --compile --target="$target" --outfile="$OUTDIR/qc-${target#bun-}"
done

echo "Binaries built in $OUTDIR/"
ls -la "$OUTDIR/"
