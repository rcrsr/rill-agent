#!/bin/bash
set -e

# Verify all agent packages share the same version as root package.json.
# Usage: ./scripts/check-versions-agent.sh
# Exit code 0 = all consistent, 1 = mismatch found.

ROOT_VERSION=$(node -p "require('./package.json').version")
ERRORS=0

for pkg in packages/agent/*/; do
  pkg="${pkg%/}"
  [ -f "$pkg/package.json" ] || continue

  NAME=$(node -p "require('./$pkg/package.json').name")
  VERSION=$(node -p "require('./$pkg/package.json').version")

  if [ "$VERSION" != "$ROOT_VERSION" ]; then
    echo "MISMATCH: $NAME is $VERSION (expected $ROOT_VERSION)" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS version mismatch(es). Root version: $ROOT_VERSION" >&2
  exit 1
fi

echo "All agent packages at v$ROOT_VERSION"
