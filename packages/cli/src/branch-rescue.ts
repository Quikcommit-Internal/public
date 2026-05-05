import {
  getHeadSha,
  getUpstreamRef,
  stashPushIfDirty,
  stashPop,
  createBranch,
  checkoutBranch,
  resetHard,
  deleteBranch,
} from "./git.js";

export interface RescueOpts {
  currentBranch: string;
  newBranch: string;
}

export interface RescueResult {
  newBranch: string;
  stashed: boolean;
  upstreamRef: string;
  movedFromSha: string;
}

/**
 * Move commits from the current (protected) branch onto a new branch,
 * then reset the protected branch back to its upstream.
 */
export function rescueCommits(opts: RescueOpts): RescueResult {
  const upstream = getUpstreamRef(opts.currentBranch);
  if (!upstream) {
    throw new Error(
      `No upstream tracking branch for '${opts.currentBranch}'. Push it first or use \`qc branch\` manually.`
    );
  }

  const headSha = getHeadSha();
  const stashed = stashPushIfDirty(`qc-rescue-${opts.newBranch}`);

  try {
    createBranch(opts.newBranch, headSha);
  } catch (err) {
    if (stashed) {
      try {
        stashPop();
      } catch {
        /* best effort */
      }
    }
    throw err;
  }

  try {
    resetHard(upstream);
  } catch (err) {
    // Clean up: delete the just-created new branch so repo state stays consistent.
    try {
      deleteBranch(opts.newBranch);
    } catch {
      /* best effort */
    }
    // Restore the working tree if we stashed it.
    if (stashed) {
      try {
        stashPop();
      } catch {
        /* best effort */
      }
    }
    throw new Error(
      `Rescue aborted: failed to reset ${opts.currentBranch} to upstream. ` +
        `Your repo state has been restored. ` +
        `Original error: ${(err as Error)?.message ?? String(err)}`
    );
  }

  try {
    checkoutBranch(opts.newBranch);
  } catch (err) {
    try {
      resetHard(headSha);
    } catch {
      /* best effort */
    }
    if (stashed) {
      try {
        stashPop();
      } catch {
        /* best effort */
      }
    }
    throw err;
  }

  if (stashed) {
    try {
      stashPop();
    } catch (err) {
      throw new Error(
        "Stash conflict during recovery. Your changes are preserved in the stash entry. " +
          "Resolve manually with `git stash pop` then `git stash drop` after resolving conflicts.\n" +
          `Original error: ${(err as Error)?.message ?? err}`
      );
    }
  }

  return {
    newBranch: opts.newBranch,
    stashed,
    upstreamRef: upstream,
    movedFromSha: headSha,
  };
}
