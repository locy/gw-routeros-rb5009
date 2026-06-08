# Auto-README Rule

## Global Rule: All Projects Auto-Generate README.md

**When creating, modifying, or completing any project, automatically:**

### 1. Auto-Edit README.md (if exists)
- Update version, features, architecture, API endpoints
- Keep existing content, update changed sections
- No manual intervention needed

### 2. Auto-Create README.md (if missing)
- Detect project type (Deno, Node, Rust, Python, Go, etc.)
- Generate comprehensive README with:
  - Project title + version
  - Feature list with descriptions
  - Architecture diagram (ASCII)
  - Quick start instructions
  - Environment variables / config
  - API endpoints (if web server)
  - Development commands (test, fmt, lint)
  - Versioning info
  - License

### 3. Auto-Update on Significant Changes
- New major feature → update feature list
- API changes → update endpoint table
- Config changes → update env table
- Version bump → update version field

## Workflow

1. `git diff HEAD~10` — detect what changed
2. If README missing → generate from project analysis
3. If README exists → update version/features/API/commands
4. Commit: `docs: update README.md`

## Applies To

- All git repositories
- All programming languages/frameworks
- All PR reviews
- All project scaffolding
