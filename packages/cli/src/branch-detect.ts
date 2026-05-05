const HARDCODED_PROTECTED = ["main", "master", "develop", "trunk"];

/**
 * Match a branch name against a glob pattern.
 * Supports * (any non-slash chars within one segment) and ** (any chars across
 * multiple segments). Matching is case-insensitive.
 *
 * Examples:
 *   matchGlob("release/v1",   "release/*")    → true
 *   matchGlob("release/v1/x", "release/*")    → false (single * stops at slash)
 *   matchGlob("release/v1/x", "release/**")   → true
 *   matchGlob("release/v1",   "release/**")   → true
 */
function matchGlob(name: string, pattern: string): boolean {
  const n = name.toLowerCase();
  const p = pattern.toLowerCase();
  if (!p.includes("*")) return n === p;
  // Escape regex special chars except *
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  // Replace ** first (using a placeholder to avoid the single-* replace consuming it),
  // then replace remaining * with single-segment matcher.
  const withDoubleStar = escaped.replace(/\*\*/g, "\x00DOUBLE_STAR\x00");
  const withSingleStar = withDoubleStar.replace(/\*/g, "[^/]*");
  // eslint-disable-next-line no-control-regex
  const final = withSingleStar.replace(/\x00DOUBLE_STAR\x00/g, ".*");
  const rx = new RegExp("^" + final + "$");
  return rx.test(n);
}

export function isProtectedBranch(branch: string, protectedList: string[]): boolean {
  if (!protectedList || protectedList.length === 0) return false;
  return protectedList.some((p) => matchGlob(branch, p));
}

interface ResolveOpts {
  configList?: string[];
  detectDefault: boolean;
  defaultBranch: string | null;
}

export function resolveProtectedBranches(opts: ResolveOpts): string[] {
  const set = new Set<string>();

  if (opts.configList && opts.configList.length > 0) {
    for (const b of opts.configList) set.add(b);
  } else {
    for (const b of HARDCODED_PROTECTED) set.add(b);
  }

  if (opts.detectDefault && opts.defaultBranch) {
    set.add(opts.defaultBranch);
  }

  return Array.from(set);
}
