#!/bin/bash
# Deprecated wrapper. Use:
#   node scripts/spec-dev.mjs archive --root <project-root>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${1:-.}"

echo "scripts/archive.sh is deprecated; use scripts/spec-dev.mjs archive instead." >&2
node "${SCRIPT_DIR}/spec-dev.mjs" archive --root "${PROJECT_ROOT}"
