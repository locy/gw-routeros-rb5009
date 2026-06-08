#!/usr/bin/env bash
# Auto-increment version in deno.json and git tag
# Usage: bump-version.sh [patch|minor|major]
set -euo pipefail
cd "$(dirname "$0")/.."

PART="${1:-patch}"
if ! echo "$PART" | grep -qE '^(patch|minor|major)$'; then
  echo "Usage: $0 [patch|minor|major]"
  exit 1
fi

# Read current version from deno.json
CURRENT=$(python3 -c "import json; print(json.load(open('deno.json'))['version'])")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$PART" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"

# Update deno.json
python3 -c "
import json
d = json.load(open('deno.json'))
d['version'] = '$NEW_VERSION'
json.dump(d, open('deno.json', 'w'), indent=2)
print('deno.json version: $CURRENT -> $NEW_VERSION')
"

# Update git tag
git tag -d "v$CURRENT" 2>/dev/null || true
git tag -a "v$NEW_VERSION" -m "v$NEW_VERSION"
echo "git tag: v$CURRENT -> v$NEW_VERSION"
