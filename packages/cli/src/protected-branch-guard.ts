import { isProtectedBranch, resolveProtectedBranches } from "./branch-detect.js";
import { getCurrentBranch, getCommitsAheadOfUpstream, getDefaultBranch } from "./git.js";

export interface ShouldRunOpts {
  allowProtected: boolean;
  hookMode: boolean;
  /**
   * True when stdin is a TTY. Hooks and pipelines skip the guard so prompts are not blocked.
   * (Rich boxed output still keys off stderr TTY in display helpers.)
   */
  isTTY: boolean;
}

export function shouldRunGuard(opts: ShouldRunOpts): boolean {
  if (opts.allowProtected) return false;
  if (opts.hookMode) return false;
  if (!opts.isTTY) return false;
  return true;
}

export interface ProtectedBranchState {
  isProtected: boolean;
  branch: string;
  commitsAhead: number;
  mode: "uncommitted" | "rescue" | "none";
}

export interface DetectOpts {
  protectedBranches?: string[];
  detectDefault?: boolean;
}

export function detectProtectedBranchState(opts: DetectOpts): ProtectedBranchState {
  const branch = getCurrentBranch();
  const protectedList = resolveProtectedBranches({
    configList: opts.protectedBranches,
    detectDefault: opts.detectDefault !== false,
    defaultBranch: getDefaultBranch(),
  });

  const protectedBranch = isProtectedBranch(branch, protectedList);
  if (!protectedBranch) {
    return { isProtected: false, branch, commitsAhead: 0, mode: "none" };
  }

  const commitsAhead = getCommitsAheadOfUpstream(branch);
  const mode = commitsAhead > 0 ? "rescue" : "uncommitted";
  return { isProtected: true, branch, commitsAhead, mode };
}
