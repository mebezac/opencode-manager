#!/bin/bash
set -e

export HOME=/home/opencode

echo "🔍 Checking Bun installation..."

BUN_VERSION=$(bun --version 2>&1 || echo "unknown")
echo "✅ Bun is installed (version: $BUN_VERSION)"

echo "🔍 Checking OpenCode installation..."

MIN_OPENCODE_VERSION="1.0.137"

version_gte() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

OPENCODE_VERSION=$(opencode --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
echo "✅ OpenCode is installed (version: $OPENCODE_VERSION)"

if [ "$OPENCODE_VERSION" != "unknown" ]; then
  if version_gte "$OPENCODE_VERSION" "$MIN_OPENCODE_VERSION"; then
    echo "✅ OpenCode version meets minimum requirement (>=$MIN_OPENCODE_VERSION)"
  else
    echo "⚠️  OpenCode version $OPENCODE_VERSION is below minimum required version $MIN_OPENCODE_VERSION"
    echo "🔄 Upgrading OpenCode..."
    opencode upgrade || curl -fsSL https://opencode.ai/install | bash

    OPENCODE_VERSION=$(opencode --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
    echo "✅ OpenCode upgraded to version: $OPENCODE_VERSION"
  fi
fi

echo "🚀 Starting OpenCode Manager Backend..."

exec "$@"
