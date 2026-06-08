# Auto-Versioning Rule

## Global Rule: All Projects Auto-Version

**When creating or initializing any new project, automatically:**

1. **`git init`** — Initialize git repository
2. **`./scripts/bump-version.sh`** — Add auto-increment version script
3. **Add `"version"` field** to project manifest:
   - Deno: `deno.json` → `"version": "0.1.0"`
   - Node: `package.json` → `"version": "0.1.0"`
   - Rust: `Cargo.toml` → `version = "0.1.0"`
   - Python: `pyproject.toml` → `version = "0.1.0"`
   - Go: `go.mod` + tag `v0.1.0`
4. **`post-commit` hook** — Detect commits since last tag, prompt bump

## Version Bump Script (`bump-version.sh`)

- Auto-detects manifest type (deno.json, package.json, Cargo.toml, pyproject.toml, go.mod)
- Supports `patch`, `minor`, `major` bumps
- Updates manifest file
- Creates git tag `vX.Y.Z`
- Usage: `./scripts/bump-version.sh [patch|minor|major]`

## Workflow

1. New project → `./scripts/init-project.sh <dir>` or manual setup
2. Development → commits accumulate
3. `post-commit` hook detects changes since last tag
4. Developer runs: `./scripts/bump-version.sh minor` (or appropriate level)
5. Version tag pushed to remote

## Rule Applies To

- All git repositories
- All programming languages/frameworks
- All CI/CD pipelines
- All project scaffolding
