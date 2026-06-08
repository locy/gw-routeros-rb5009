#!/usr/bin/env bash
# Auto-initialize git repo and add auto-bump version feature
# Usage: init-project.sh <project-root>
set -euo pipefail

PROJECT_DIR="${1:-.}"
PROJECT_NAME=$(basename "$(cd "$PROJECT_DIR" && pwd)")
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Project Init ==="
echo "Target: $PROJECT_DIR ($PROJECT_NAME)"

# 1. git init
cd "$PROJECT_DIR"
if git rev-parse --git-dir &>/dev/null; then
  echo "✅ git already initialized"
else
  git init
  git add .
  git commit -m "chore: initial commit" --allow-empty 2>/dev/null || true
  echo "✅ git initialized"
fi

# 2. Create bump-version.sh
BUMP_SCRIPT="$PROJECT_DIR/scripts/bump-version.sh"
mkdir -p "$PROJECT_DIR/scripts"
cat > "$BUMP_SCRIPT" << 'SCRIPT'
#!/usr/bin/env bash
# Auto-increment version in deno.json, package.json, pyproject.toml, Cargo.toml, or go.mod
# Usage: bump-version.sh [patch|minor|major]
set -euo pipefail
cd "$(dirname "$0")/.."

PART="${1:-patch}"
if ! echo "$PART" | grep -qE '^(patch|minor|major)$'; then
  echo "Usage: $0 [patch|minor|major]"
  exit 1
fi

# Detect manifest type and extract version
VERSION=""
MANIFEST=""

if [ -f "deno.json" ]; then
  VERSION=$(python3 -c "import json; print(json.load(open('deno.json')).get('version','0.0.0'))" 2>/dev/null || echo "0.0.0")
  MANIFEST="deno.json"
elif [ -f "package.json" ]; then
  VERSION=$(python3 -c "import json; print(json.load(open('package.json')).get('version','0.0.0'))" 2>/dev/null || echo "0.0.0")
  MANIFEST="package.json"
elif [ -f "Cargo.toml" ]; then
  VERSION=$(grep -oP '^version\s*=\s*"\K[^"]+' Cargo.toml 2>/dev/null || echo "0.0.0")
  MANIFEST="Cargo.toml"
elif [ -f "pyproject.toml" ]; then
  VERSION=$(grep -oP '^version\s*=\s*"\K[^"]+' pyproject.toml 2>/dev/null || echo "0.0.0")
  MANIFEST="pyproject.toml"
elif [ -f "go.mod" ]; then
  VERSION=$(grep -oP '^module .*\nversion \K.+' go.mod 2>/dev/null || echo "0.0.0")
  [ -z "$VERSION" ] && VERSION="0.0.0"
  MANIFEST="go.mod"
else
  # Default to deno.json
  echo '{"version": "0.0.0"}' > deno.json
  VERSION="0.0.0"
  MANIFEST="deno.json"
fi

echo "Manifest: $MANIFEST | Current version: $VERSION"

IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"
MAJOR="${MAJOR##0}"
MINOR="${MINOR##0}"
PATCH="${PATCH##0}"
: ${MAJOR:=0}; : ${MINOR:=0}; : ${PATCH:=0}

case "$PART" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo "Bumping: $VERSION → $NEW_VERSION ($PART)"

# Update manifest based on type
if [ "$MANIFEST" = "deno.json" ] || [ "$MANIFEST" = "package.json" ]; then
  python3 -c "
import json
d = json.load(open('$MANIFEST'))
d['version'] = '$NEW_VERSION'
json.dump(d, open('$MANIFEST', 'w'), indent=2, ensure_ascii=False)
print('  $MANIFEST updated')
"
elif [ "$MANIFEST" = "Cargo.toml" ]; then
  sed -i "s/^version = \".*\"/version = \"$NEW_VERSION\"/" Cargo.toml
  echo "  Cargo.toml updated"
elif [ "$MANIFEST" = "pyproject.toml" ]; then
  sed -i "s/^version = \".*\"/version = \"$NEW_VERSION\"/" pyproject.toml
  echo "  pyproject.toml updated"
elif [ "$MANIFEST" = "go.mod" ]; then
  # Go modules use pseudo-versions or semver tags; update go.mod version comment
  echo "  go.mod: update version manually or use go get"
fi

# Git tag (if repo initialized)
if git rev-parse --git-dir &>/dev/null; then
  OLD_TAG="v$VERSION"
  NEW_TAG="v$NEW_VERSION"
  git tag -d "$OLD_TAG" 2>/dev/null || true
  git tag -a "$NEW_TAG" -m "v$NEW_VERSION"
  echo "  git tag: $OLD_TAG → $NEW_TAG"
  echo "  Run: git push origin $NEW_TAG"
fi

echo "✅ Done"
SCRIPT
chmod +x "$BUMP_SCRIPT"
echo "✅ bump-version.sh created"

# 3. Create post-commit hook
mkdir -p "$PROJECT_DIR/.git/hooks"
cat > "$PROJECT_DIR/.git/hooks/post-commit" << 'HOOKEOF'
#!/usr/bin/env bash
# Notify about manual version bump needed
set -euo pipefail
cd "$(dirname "$0")/../.."

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [ -z "$LAST_TAG" ]; then
  exit 0
fi

SINCE_TAG=$(git log --oneline "$LAST_TAG"..HEAD 2>/dev/null | wc -l)
if [ "$SINCE_TAG" -gt 0 ]; then
  echo "post-commit: $SINCE_TAG commit(s) since $LAST_TAG — bump version: ./scripts/bump-version.sh [patch|minor|major]"
fi
HOOKEOF
chmod +x "$PROJECT_DIR/.git/hooks/post-commit"
echo "✅ post-commit hook created"

# 4. Add .gitignore with version bump artifacts
cat >> "$PROJECT_DIR/.gitignore" 2>/dev/null << 'EOF' 2>/dev/null || true
# Version bump
scripts/bump-version.sh
.git/hooks/post-commit
EOF

echo "=== Init complete: $PROJECT_DIR ==="
echo "Usage: cd $PROJECT_DIR && ./scripts/bump-version.sh [patch|minor|major]"
echo "Example: ./scripts/bump-version.sh minor  →  0.1.0 → 0.2.0"
