# Commitlint Integration - Quick Reference

> One-page reference for Quikcommit's commitlint integration feature

## Quick Start

```bash
# If you already have commitlint configured, Quikcommit just works!
qc

# Check what rules are detected
qc --debug --message-only
```

### Works Immediately When

✅ Project has commitlint configured
✅ Config is in **JSON** or **YAML** format (requires jq, optionally yq)
✅ OR config is **JavaScript** with static arrays only
✅ Config has **explicit rules** (not just 'extends' references)
✅ jq is installed on your system

### Does NOT Work With

❌ TypeScript configs (require compilation)
❌ JavaScript configs with functions/imports
❌ Configs relying only on 'extends' references
❌ YAML configs without yq installed

## Supported Config Files

| Format | Files | Status |
|--------|-------|--------|
| JSON | `.commitlintrc.json`, `.commitlintrc` | ✅ Fully supported |
| YAML | `.commitlintrc.yaml`, `.commitlintrc.yml` | ✅ Requires `yq` |
| JavaScript | `.commitlintrc.js`, `commitlint.config.js` | ⚠️ Static arrays only |
| TypeScript | `.commitlintrc.ts`, `commitlint.config.ts` | ❌ Not supported |
| Package.json | `package.json`, `package.yaml` | ✅ Fully supported |

## Extracted Rules (9 Core Rules)

| Rule | Description | Example Value | Status |
|------|-------------|---------------|--------|
| `type-enum` | Allowed types | `["feat", "fix", "docs"]` | ✅ Extracted |
| `scope-enum` | Allowed scopes | `["api", "ui", "database"]` | ✅ Extracted |
| `type-case` | Type capitalization | `"lower-case"` | ✅ Extracted |
| `scope-case` | Scope capitalization | `"kebab-case"` | ✅ Extracted |
| `subject-case` | Subject capitalization | `"sentence-case"` | ✅ Extracted |
| `header-max-length` | Header length limit | `72` | ✅ Extracted |
| `subject-max-length` | Subject length limit | `50` | ✅ Extracted |
| `body-max-line-length` | Body line length | `100` | ✅ Extracted |
| `subject-full-stop` | Punctuation to avoid | `"."` | ✅ Extracted |
| `scope-empty` | Whether scopes required/forbidden | N/A | ⏳ Planned |

**Note:** Quikcommit provides **core rule compliance** covering the 9 most common rules. The `scope-empty` rule is not yet extracted but planned for future support.

## Example Configurations

### Minimal (JSON)

```json
{
  "rules": {
    "type-enum": [2, "always", ["feat", "fix", "docs"]],
    "scope-enum": [2, "always", ["api", "ui"]]
  }
}
```

### Comprehensive (JSON)

```json
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "type-enum": [2, "always", ["feat", "fix", "docs", "refactor", "test"]],
    "scope-enum": [2, "always", ["api", "ui", "database", "auth"]],
    "type-case": [2, "always", "lower-case"],
    "scope-case": [2, "always", "kebab-case"],
    "subject-case": [2, "always", "sentence-case"],
    "header-max-length": [2, "always", 72],
    "subject-max-length": [2, "always", 50],
    "body-max-line-length": [2, "always", 100],
    "subject-full-stop": [2, "never", "."]
  }
}
```

### JavaScript (Static Arrays)

```javascript
module.exports = {
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'docs']],
    'scope-enum': [2, 'always', ['api', 'ui', 'database']]
  }
};
```

## Troubleshooting Cheat Sheet

### Rules not detected?

```bash
# Check debug output
qc --debug --message-only

# Look for:
# DEBUG: Commitlint config found: <filename>
# DEBUG: Extracted rules: {...}
```

**Common fixes:**
- TypeScript config → Convert to `.commitlintrc.json`
- Functions in JS → Use static arrays only
- Missing `jq` → `brew install jq` (macOS)
- Missing `yq` → `brew install yq` (macOS)

### YAML not working?

```bash
# Install yq
brew install yq  # macOS
sudo apt install yq  # Linux

# Or use JSON instead
mv .commitlintrc.yaml .commitlintrc.json
```

### JavaScript config partially working?

**✅ Works:**
```javascript
'scope-enum': [2, 'always', ['api', 'ui']]  // Static
```

**❌ Doesn't work:**
```javascript
'scope-enum': () => [2, 'always', getScopes()]  // Function
```

**Fix:** Convert to JSON or use static values only.

### Extended configs not loaded?

```json
{
  "extends": ["@commitlint/config-conventional"]
  // ❌ This won't be resolved
}
```

**Fix:** Add explicit rules:
```json
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "type-enum": [2, "always", ["feat", "fix", "docs", "refactor", "test"]],
    "scope-enum": [2, "always", ["api", "ui", "database"]]
  }
}
```

## Case Options Reference

| Option | Example |
|--------|---------|
| `lower-case` | `add new feature` |
| `upper-case` | `ADD NEW FEATURE` |
| `camel-case` | `addNewFeature` |
| `kebab-case` | `add-new-feature` |
| `pascal-case` | `AddNewFeature` |
| `sentence-case` | `Add new feature` |
| `snake-case` | `add_new_feature` |
| `start-case` | `Add New Feature` |

## Default Values (No Config)

If no commitlint config is found, these defaults apply:

```json
{
  "types": ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "style", "test"],
  "typeCase": "lower-case",
  "scopeCase": "lower-case",
  "headerMaxLength": 72,
  "subjectMaxLength": 50,
  "bodyMaxLineLength": 100,
  "subjectFullStop": "."
}
```

**⚠️ Important Notes:**

1. **headerMaxLength Default:**
   - `@commitlint/config-conventional` uses **100** characters
   - Quikcommit uses **72** characters (Git's 50/72 rule)
   - If you extend `@commitlint/config-conventional` without explicit `header-max-length`, Quikcommit will use **72** (not 100)
   - Why: Quikcommit doesn't resolve `extends` - only explicit rules are used
   - Solution: Add explicit rule: `"header-max-length": [2, "always", 100]`

2. **subjectCase Semantics:**
   - Rules use `'never'` (prohibited) or `'always'` (allowed)
   - `@commitlint/config-conventional` prohibits certain cases (using `'never'`)
   - **Known limitation**: Quikcommit may not fully respect `'never'` semantic
   - Best practice: Use explicit `'always'` rules: `"subject-case": [2, "always", "lower-case"]`

## Testing Your Config

```bash
# 1. Generate message only
qc --message-only > /tmp/commit-msg.txt

# 2. Validate with commitlint
cat /tmp/commit-msg.txt | npx commitlint

# 3. Check result
echo $?  # 0 = success
```

## Best Practices

1. **Use JSON** - Most reliable format
2. **Be explicit** - Don't rely on `extends`
3. **Keep scopes manageable** - 5-10 scopes is ideal
4. **Use single case option** - Avoid multiple choices
5. **Set reasonable limits** - 72/50/100 is standard
6. **Test your config** - Verify with debug mode

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ 1. DETECTION PHASE                                  │
│    Scan for config files (18 formats)               │
│    Priority: .commitlintrc.json → .yaml → .js      │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ 2. EXTRACTION PHASE                                 │
│    Parse config (jq/yq/regex)                       │
│    Extract enforceable rules                        │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ 3. TRANSMISSION PHASE                               │
│    Add rules to API payload                         │
│    Send to AI provider (all providers)              │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ 4. APPLICATION PHASE                                │
│    Construct strict prompt with rules               │
│    AI generates compliant commit message            │
└─────────────────────────────────────────────────────┘
```

## Limitations Summary

**❌ Not Supported:**
- TypeScript configs (compilation needed)
- JavaScript functions (security/complexity)
- Async functions
- Imports/requires
- Extended config resolution (node_modules)
- Complex JavaScript expressions

**✅ Supported:**
- JSON configs (via `jq`)
- YAML configs (via `yq`)
- Static JavaScript arrays
- Static object notation
- Package.json/package.yaml fields

## Learn More

- [Full Documentation](./commitlint-integration.md) - Comprehensive guide with examples
- [Design Document](./plans/2026-01-26-commitlint-integration-design.md) - Technical design
- [Commitlint Docs](https://commitlint.js.org/) - Official commitlint documentation
- [Conventional Commits](https://www.conventionalcommits.org/) - Commit message format

## Support

If you encounter issues:

1. Run with `--debug` flag
2. Check [Troubleshooting Guide](./commitlint-integration.md#troubleshooting-guide)
3. Open an issue on GitHub
4. Include debug output in bug reports
