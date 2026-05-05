import readline from "node:readline/promises";
import type { CommitRules, CommitGenerationHints } from "@quikcommit/shared";
import type { UI } from "./ui.js";
import {
  renderBoxedCommit,
  renderStatsLine,
  shouldUseRichOutput,
  getTerminalWidth,
  renderFileTree,
  type StatsInput,
} from "./ui-rich.js";

/** Merge `-t` / `-S` into rules so the model is constrained like HELP describes. */
export function applyCliTypeScopeToRules(
  rules: CommitRules,
  type: string | undefined,
  scope: string | undefined
): CommitRules {
  let next = { ...rules };
  if (type) {
    next = { ...next, types: [type] };
  }
  if (scope) {
    next = { ...next, scopes: [scope] };
  }
  return next;
}

export function generationHintsFromArgs(
  split: boolean,
  forceBody: boolean
): CommitGenerationHints | undefined {
  const h: CommitGenerationHints = {};
  if (split) h.split = true;
  if (forceBody) h.force_body = true;
  return Object.keys(h).length > 0 ? h : undefined;
}

/**
 * Split a conventional commit into subject (first line) and body for display.
 * Handles both `subject\n\nbody` and `subject\nbody` (no blank line).
 */
export function splitCommitMessageForDisplay(message: string): { subject: string; body: string } {
  const t = message.replace(/\r\n/g, "\n").trimEnd();
  const doubleNl = t.indexOf("\n\n");
  if (doubleNl !== -1) {
    const head = t.slice(0, doubleNl);
    const subject = head.split("\n")[0]?.trim() ?? "";
    return { subject, body: t.slice(doubleNl + 2).trimEnd() };
  }
  const firstNl = t.indexOf("\n");
  if (firstNl === -1) {
    return { subject: t.trim(), body: "" };
  }
  return {
    subject: t.slice(0, firstNl).trim(),
    body: t.slice(firstNl + 1).trimEnd(),
  };
}

export function formatVerboseCommitDiagnostics(diagnostics: unknown, roundTripMs: number): string {
  const lines: string[] = [`api_round_trip_ms: ${roundTripMs}`];
  if (diagnostics !== undefined) {
    lines.push(JSON.stringify(diagnostics, null, 2));
  }
  return lines.join("\n");
}

export type RefineResult =
  | { action: "accept"; message: string }
  | { action: "abort" }
  | { action: "edit"; message: string };

/** Optional refine before commit; skipped when stdin is not a TTY. */
export async function interactiveRefineMessage(
  initial: string,
  opts: { skip: boolean }
): Promise<RefineResult> {
  if (opts.skip) return { action: "accept", message: initial };

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(`\n${initial}\n\n`);
    const choice = (await rl.question("Keep? [Y/n/e]: ")).trim().toLowerCase();
    if (choice === "n") {
      return { action: "abort" };
    }
    if (choice === "e") {
      process.stderr.write("Enter new message (end with a line containing only .):\n");
      const lines: string[] = [];
      while (true) {
        const line = await rl.question("");
        if (line === ".") break;
        lines.push(line);
      }
      const edited = lines.join("\n").trim();
      return { action: "edit", message: edited.length > 0 ? edited : initial };
    }
    return { action: "accept", message: initial };
  } finally {
    rl.close();
  }
}

export type ConfirmResult = { action: "commit" } | { action: "abort" };

/**
 * Shared Y/n prompt used by both the branch guard and commands/branch.ts.
 * Extracted as Item I to prevent the two formerly private prompt functions
 * (`confirmRescuePrompt` and `confirmBranchRescue`) from drifting.
 *
 * @param question - The question text (without the "[Y/n]" suffix).
 * @param defaultYes - When true (default), an empty answer is treated as "yes".
 * @returns true when the user confirms, false when the user declines.
 */
export async function promptYesNo(
  question: string,
  defaultYes: boolean = true
): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  try {
    const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
    if (answer === "n" || answer === "no") return false;
    if (answer === "y" || answer === "yes") return true;
    return defaultYes;
  } finally {
    rl.close();
  }
}

/** @deprecated Use confirmCommit instead. */
export async function confirmCommitOrExit(prompt: string, opts: { skip: boolean }): Promise<void> {
  const result = await confirmCommit(prompt, opts);
  if (result.action === "abort") {
    process.exit(0);
  }
}

export async function confirmCommit(prompt: string, opts: { skip: boolean }): Promise<ConfirmResult> {
  if (opts.skip) return { action: "commit" };

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const ans = (await rl.question(prompt)).trim().toLowerCase();
    if (ans !== "y" && ans !== "yes") {
      return { action: "abort" };
    }
    return { action: "commit" };
  } finally {
    rl.close();
  }
}

export function shouldSkipTTYInteraction(hookMode: boolean | undefined): boolean {
  return hookMode === true || process.stdin.isTTY !== true;
}

/** stderr logging for verbose block (respects quiet via caller). */
export function logVerboseDiagnostics(
  dim: (msg: string) => void,
  verbose: boolean,
  quiet: boolean,
  diagnostics: unknown,
  roundTripMs: number
): void {
  if (!verbose || quiet) return;
  process.stderr.write(
    `\n${formatVerboseCommitDiagnostics(diagnostics, roundTripMs)}\n`
  );
  dim("(verbose diagnostics on stderr)");
}

/**
 * A minimal subset of `UI["log"]` used by display helpers.
 * Both index.ts (SaaS path) and local.ts build objects that satisfy this shape.
 */
export type LogLike = Pick<UI["log"], "step" | "success" | "error" | "dim">;

export interface DisplayOpts {
  log: LogLike;
  isColor?: boolean;
  isTTY?: boolean;
  style?: "rich" | "compact" | "minimal";
  stats?: StatsInput;
  /** Staged paths (e.g. `git diff --cached --name-only`) shown as a tree in rich mode */
  stagedFiles?: string[];
}

function isDisplayOpts(opts: LogLike | DisplayOpts): opts is DisplayOpts {
  return typeof opts === "object" && opts !== null && "log" in opts;
}

/**
 * Build a silent log object that suppresses all output except errors.
 * Centralises the pattern used identically in runCommit and runLocalCommit.
 */
export function createSilentLog(): LogLike {
  return {
    step: () => {},
    success: () => {},
    error: (msg: string) => console.error(msg),
    dim: () => {},
  };
}

/**
 * Print the commit message to stderr. Pass `{ log, isColor, ... }` for boxed rich output
 * when in a TTY, or pass a {@link LogLike} for plain legacy behavior.
 */
export function displayCommitMessage(message: string, opts: LogLike | DisplayOpts): void {
  const display: DisplayOpts = isDisplayOpts(opts) ? opts : { log: opts };

  const log = display.log;
  const { subject, body } = splitCommitMessageForDisplay(message);

  const tw = getTerminalWidth();
  const useRich = shouldUseRichOutput({
    isTTY: display.isTTY ?? !!process.stderr.isTTY,
    noColor: display.isColor === false,
    width: tw,
    style: display.style ?? "rich",
  });

  if (useRich) {
    const tree =
      display.stagedFiles && display.stagedFiles.length > 0
        ? renderFileTree(display.stagedFiles, 8)
        : "";
    if (tree) {
      process.stderr.write(tree + "\n");
    }
    const boxed = renderBoxedCommit(subject, body, {
      width: Math.min(Math.max(tw - 4, 60), 80),
      isColor: !!display.isColor,
    });
    process.stderr.write(boxed + "\n");
    if (display.stats) {
      process.stderr.write(renderStatsLine(display.stats, !!display.isColor) + "\n");
    }
    return;
  }

  log.success(subject);
  if (body) {
    for (const line of body.split("\n")) {
      log.dim(`  ${line}`);
    }
    process.stderr.write("\n");
  }
}
