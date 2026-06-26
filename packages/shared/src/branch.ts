/**
 * Shared branch name validation constants and helpers.
 * Used by both the CLI package and the AI worker to avoid duplication.
 *
 * The regex was updated in Wave 1:
 *   - slug starts with [a-z0-9]
 *   - slug body allows 0-51 additional chars (was 1-55 in ai-worker)
 *   - this permits single-word slugs like "feat/ci" and enforces the 60-char max
 */
export const BRANCH_NAME_RX =
  /^(feat|fix|refactor|perf|docs|test|chore|ci)\/[a-z0-9][a-z0-9-]{0,51}$/;

export const PROTECTED_BRANCH_RX =
  /(^|[/-])(main|master|develop|trunk|release)([/-]|$)/i;

export const MAX_BRANCH_NAME_LENGTH = 60;

export const ALLOWED_BRANCH_TYPES = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "docs",
  "test",
  "chore",
  "ci",
] as const;

/**
 * Returns true if the given string is a valid branch name.
 * Checks length, pattern, and protected-branch rejection.
 */
export function validateBranchName(name: string): boolean {
  if (typeof name !== "string") return false;
  if (name.length > MAX_BRANCH_NAME_LENGTH) return false;
  if (!BRANCH_NAME_RX.test(name)) return false;
  if (PROTECTED_BRANCH_RX.test(name)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Deterministic fallback (no AI required)
// Shared between CLI and AI worker to avoid implementation drift.
// ---------------------------------------------------------------------------

export const TYPE_HINTS: Array<[RegExp, string]> = [
  [/\b(ci|workflow)\b|github\/actions/i, "ci"],
  [/\b(perf|benchmark)\b/i, "perf"],
  [/\brefactor\b/i, "refactor"],
  [/\b(fix|bug|issue|patch)\b/i, "fix"],
  [/\b(feat|add|new)\b/i, "feat"],
  [/\b(docs?)\b|\breadme\b/i, "docs"],
  [/\b(test|spec)\b/i, "test"],
];

export function slugifyFilename(path: string): string {
  const basename = path.split("/").pop() ?? path;
  const noExt = basename.replace(/\.[^.]+$/, "");
  return noExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Generate a deterministic branch name from file paths or a description string,
 * with no AI inference. Used as a fallback when both SaaS and local providers are
 * unavailable. Shared across CLI and AI worker.
 */
const NON_CODE_PATTERNS = [
  /^docs?\//i,
  /^\.env/,
  /\.md$/i,
  /^readme/i,
  /^changelog/i,
  /^license/i,
  /\.lock$/,
  /\.ya?ml$/,
  /\.json$/,
  /\.toml$/,
  /\/\.?config\b/i,
  /\.config\.[a-z]+$/i,  // root-level config: eslint.config.mjs, vitest.config.ts
  /^\.github\//,
  /^\.vscode\//,
];

/** True when the path looks like a test/spec file. */
function isTestPath(f: string): boolean {
  return /\.(test|spec)\.[^.]+$/i.test(f) || /^tests?\//i.test(f);
}

function pickBestFile(files: string[]): string {
  const codeFiles = files.filter(
    (f) => !NON_CODE_PATTERNS.some((rx) => rx.test(f))
  );
  // Strongly prefer source directories over everything else
  const srcDirs = codeFiles.filter((f) => /^(src|lib|app|packages)\//.test(f));
  // Among source dirs, prefer non-test files
  const nonTestSrc = srcDirs.filter((f) => !isTestPath(f));
  return nonTestSrc[0] ?? srcDirs[0] ?? codeFiles[0] ?? files[0] ?? "";
}

/**
 * Infer branch type from file categories instead of keyword-matching the
 * concatenated path list (which lets "test" in a path like tests/foo.test.ts
 * dominate over 30 src/ changes).
 */
function inferTypeFromFiles(files: string[]): string {
  const isNonCode = (f: string) => NON_CODE_PATTERNS.some((rx) => rx.test(f));

  // Exclusive categorization: each file in exactly one bucket, priority order
  let srcCount = 0, testCount = 0, docCount = 0, ciCount = 0;
  for (const f of files) {
    if (/^\.github\//i.test(f)) { ciCount++; }
    else if (isTestPath(f)) { testCount++; }
    else if (/^docs?\//i.test(f) || /\.md$/i.test(f) || /^readme/i.test(f)) { docCount++; }
    else if (!isNonCode(f)) { srcCount++; }
  }

  // Pure category changes
  if (srcCount === 0 && testCount > 0 && docCount === 0 && ciCount === 0) return "test";
  if (srcCount === 0 && docCount > 0 && testCount === 0 && ciCount === 0) return "docs";
  if (srcCount === 0 && ciCount > 0 && testCount === 0 && docCount === 0) return "ci";

  // Broad source changes → refactor
  if (srcCount > 10) return "refactor";
  // Some source changes
  if (srcCount > 0) return "feat";

  // Mixed non-source: pick dominant category
  if (testCount >= docCount && testCount >= ciCount) return "test";
  if (docCount >= ciCount) return "docs";
  if (ciCount > 0) return "ci";

  return "chore";
}

export function deterministicBranchName(opts: {
  files?: string[];
  description?: string;
}): { name: string; type: string; slug: string } {
  const files = opts.files ?? [];

  let type = "chore";

  if (opts.description) {
    // Description is an intentional signal — apply TYPE_HINTS to it directly
    for (const [rx, t] of TYPE_HINTS) {
      if (rx.test(opts.description)) {
        type = t;
        break;
      }
    }
  } else if (files.length > 0) {
    type = inferTypeFromFiles(files);
  }

  let slug: string;
  if (opts.description) {
    slug = opts.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 5)
      .join("-")
      .slice(0, 40);
  } else if (files.length > 0) {
    slug = slugifyFilename(pickBestFile(files));
  } else {
    slug = "changes";
  }

  if (!slug) slug = "changes";
  if (slug.length === 1) slug = `${slug}-changes`;

  const name = `${type}/${slug}`;
  if (!validateBranchName(name)) {
    return { type: "chore", slug: "updates", name: "chore/updates" };
  }

  return { name, type, slug };
}
