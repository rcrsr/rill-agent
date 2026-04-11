#!/bin/bash
set -e

# Verify all agent and shared packages share the same version as root package.json.
# Also verify Hono version is identical across all packages that depend on it.
# Usage: ./scripts/check-versions.sh
# Exit code 0 = all consistent, 1 = mismatch found.

ROOT_VERSION=$(node -p "require('./package.json').version")
ERRORS=0

# Check package versions across agent and shared packages.
for pkg in packages/agent/*/ packages/shared/*/; do
  pkg="${pkg%/}"
  [ -f "$pkg/package.json" ] || continue

  NAME=$(node -p "require('./$pkg/package.json').name")
  VERSION=$(node -p "require('./$pkg/package.json').version")

  if [ "$VERSION" != "$ROOT_VERSION" ]; then
    echo "MISMATCH: $NAME is $VERSION (expected $ROOT_VERSION)" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

# Check Hono version is identical across all packages that declare it.
HONO_VERSION=""
for pkg in packages/agent/*/ packages/shared/*/; do
  pkg="${pkg%/}"
  [ -f "$pkg/package.json" ] || continue

  PKG_HONO=$(node -p "
    const p = require('./$pkg/package.json');
    p.dependencies?.hono ?? p.peerDependencies?.hono ?? p.devDependencies?.hono ?? ''
  ")
  [ -z "$PKG_HONO" ] && continue

  NAME=$(node -p "require('./$pkg/package.json').name")
  if [ -z "$HONO_VERSION" ]; then
    HONO_VERSION="$PKG_HONO"
  elif [ "$PKG_HONO" != "$HONO_VERSION" ]; then
    echo "HONO MISMATCH: $NAME has hono $PKG_HONO (expected $HONO_VERSION)" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS version mismatch(es). Root version: $ROOT_VERSION" >&2
  exit 1
fi

echo "All packages at v$ROOT_VERSION; Hono version consistent${HONO_VERSION:+ ($HONO_VERSION)}"
