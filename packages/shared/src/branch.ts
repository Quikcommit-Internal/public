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
  [/\btest|spec\b/i, "test"],
  [/\bdocs?\b|readme|\.md$/i, "docs"],
  [/\bperf|benchmark/i, "perf"],
  [/\brefactor\b/i, "refactor"],
  [/\bci|workflow|github\/actions/i, "ci"],
  [/\bfix|bug|issue/i, "fix"],
  [/\bfeat|add|new\b/i, "feat"],
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
  /^\.github\//,
  /^\.vscode\//,
];

function pickBestFile(files: string[]): string {
  // Prefer code files (src/, lib/, app/, packages/) over docs/config
  const codeFiles = files.filter(
    (f) => !NON_CODE_PATTERNS.some((rx) => rx.test(f))
  );
  return codeFiles[0] ?? files[0] ?? "";
}

export function deterministicBranchName(opts: {
  files?: string[];
  description?: string;
}): { name: string; type: string; slug: string } {
  const files = opts.files ?? [];
  // For type detection, prioritize code files over docs/config
  const codeFiles = files.filter(
    (f) => !NON_CODE_PATTERNS.some((rx) => rx.test(f))
  );
  const haystack = `${opts.description ?? ""} ${(codeFiles.length > 0 ? codeFiles : files).join(" ")}`;

  let type = "chore";
  for (const [rx, t] of TYPE_HINTS) {
    if (rx.test(haystack)) {
      type = t;
      break;
    }
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
