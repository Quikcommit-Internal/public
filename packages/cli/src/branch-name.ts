import { MAX_BRANCH_NAME_LENGTH, validateBranchName, deterministicBranchName } from "@quikcommit/shared";

export { validateBranchName };
// Re-export from shared so existing CLI imports keep working without change.
export { deterministicBranchName };

/**
 * Best-effort cleanup of a branch name. Returns null if it can't be salvaged
 * into a valid form.
 */
export function sanitizeBranchName(input: string): string | null {
  if (!input) return null;
  let s = input.toLowerCase().trim();
  s = s.replace(/[\s_]+/g, "-");
  s = s.replace(/[^a-z0-9/-]/g, "");
  s = s.replace(/-+/g, "-").replace(/\/+/g, "/");
  s = s.replace(/^[-/]+|[-/]+$/g, "");

  if (!s.includes("/")) return null;

  if (s.length > MAX_BRANCH_NAME_LENGTH) {
    const parts = s.split("/");
    const type = parts[0] ?? "";
    // Slug budget must satisfy both the overall length limit and the regex's
    // per-slug character limit (leading [a-z0-9] + up to 51 more = 52 max).
    const slugBudget = Math.min(MAX_BRANCH_NAME_LENGTH - type.length - 1, 52);
    if (slugBudget < 2) return null;
    s = `${type}/${parts.slice(1).join("/").slice(0, slugBudget).replace(/-+$/g, "")}`;
  }

  return validateBranchName(s) ? s : null;
}

/**
 * Append a numeric suffix until the name is unique. Calls `exists` with each
 * candidate. Throws if no unique name found within 100 attempts.
 *
 * NOTE: This is best-effort and has a TOCTOU race — between this check and the
 * actual `git branch` creation, a concurrent process could create the same
 * name. Practical risk is very low for local single-user workflows. The caller
 * should handle git's "branch already exists" error if it occurs.
 */
export function ensureUniqueName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name;
  for (let i = 2; i <= 100; i++) {
    const candidate = `${name}-${i}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`Could not find a unique name for ${name} after 100 attempts`);
}

/**
 * Validate → sanitize fallback → (optionally) ensure unique.
 *
 * This is the canonical pipeline used at every call site that receives a raw
 * generated branch name. Pass a `branchExists` function so that the pure
 * module stays free of git I/O imports (callers provide the checker from
 * `git.ts`).
 *
 * Item D: `options.skipUniqueness` — set to `true` when the caller already
 * holds an already-unique name (e.g. `generateLocalBranchName` internally
 * calls `ensureUniqueName` before returning). Skipping the outer uniqueness
 * check avoids a redundant `git show-ref` round-trip.
 *
 * Throws if the name cannot be salvaged into a valid form.
 */
export function finalizeBranchName(
  raw: string,
  exists: (candidate: string) => boolean,
  options: { skipUniqueness?: boolean } = {}
): string {
  let candidate = raw;
  if (!validateBranchName(candidate)) {
    const s = sanitizeBranchName(candidate);
    if (!s) {
      throw new Error(`Generated invalid branch name and could not sanitize: ${raw}`);
    }
    candidate = s;
  }
  if (options.skipUniqueness) {
    return candidate;
  }
  return ensureUniqueName(candidate, exists);
}

// deterministicBranchName, TYPE_HINTS, and slugifyFilename live in
// @quikcommit/shared and are re-exported above.

