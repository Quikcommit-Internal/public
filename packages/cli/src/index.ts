import { getConfig, saveConfig } from "./config.js";

const HELP = `Quikcommit - AI-powered conventional commit messages

Usage:
  qc                    Generate commit message and commit (default)
  qc pr                 Generate PR description from branch commits
  qc changelog          Generate changelog from commits since last tag
  qc changeset          Generate changesets from branch commits (pnpm monorepo)
  qc branch             Generate and create a named branch from changes
  qc init               Install prepare-commit-msg hook
  qc login              Sign in via browser
  qc logout             Clear local credentials
  qc status             Show auth, plan, usage
  qc team               Team management (info, rules, invite)
  qc config             Show/set config

Run \`qc <command> -h\` for command-specific help.

Commit flags:
  -p, --push            Commit and push
  -a, --all             Stage all files (modified + untracked) first
  -m, --message-only    Print message only (stdout, no commit)
  -v, --verbose         Show diagnostics (model, tokens, latency)
  -q, --quiet           Minimal output
  -n, --dry-run         Show message without committing
  -i, --interactive     Interactive refinement mode
  -s, --split           Multi-commit split mode
  -b, --body            Force include body
  -l, --local           Use local provider
  -c, --confirm         Ask before committing
  -t, --type <type>     Force commit type
  -S, --scope <scope>   Force scope
  -e, --exclude <pat>   Exclude files from diff (repeatable)
  --no-context          Skip commit history context
  --no-smart-diff       Skip smart diff preprocessing
  --no-color            Disable colors
  --no-animate          Disable spinner animation and success flash
  --style <name>        Box style: rounded | gradient | double | none
  --model <id>          Use specific model
  --hook-mode           Silent mode for git hooks
  --allow-protected     Bypass protected-branch guard
  --auto-branch         Auto-create branch (no prompt) when on protected branch

Compose short flags: qc -ap (stage all + push), qc -apv (+ verbose)

Examples:
  qc                    # generate and commit
  qc -p                 # commit and push
  qc -ap               # stage all, commit, push
  qc -m | pbcopy       # copy message to clipboard
  qc -n                 # preview without committing
  qc -e "*.lock"       # exclude lock files
  qc -t fix -S auth    # force type and scope
`;

const HELP_PR = `qc pr — Generate a PR description from branch commits

Usage:
  qc pr                 Generate PR description and print to stdout
  qc pr --create        Generate and open a PR via \`gh\` CLI

Flags:
  --base <branch>       Base branch to compare against (default: main)
  --create              Create the PR with \`gh pr create\` (requires gh CLI)
  --model <id>          Use specific model

Examples:
  qc pr                 # print PR description
  qc pr --create        # create the PR directly
  qc pr --base develop  # compare against develop
`;

const HELP_CHANGELOG = `qc changelog — Generate a changelog from commits since last tag

Usage:
  qc changelog          Print changelog entry to stdout
  qc changelog --write  Prepend to CHANGELOG.md

Flags:
  --from <ref>          Start ref (default: latest tag)
  --to <ref>            End ref (default: HEAD)
  --write               Write/prepend to CHANGELOG.md
  --version <ver>       Version label for header (default: derived from --to)
  --model <id>          Use specific model

Examples:
  qc changelog                     # print changelog since last tag
  qc changelog --write             # prepend to CHANGELOG.md
  qc changelog --from v1.0.0       # since a specific tag
`;

const HELP_CHANGESET = `qc changeset — Generate pnpm changesets from branch commits

Usage:
  qc changeset          Analyze commits on current branch vs base, generate .changeset/ file

Requires: commits ahead of base branch (not just staged files).
Tip: commit your changes first with \`qc\`, then run \`qc changeset\`.

Flags:
  --base <branch>       Base branch to compare against (default: main)
  --model <id>          Use specific model

Examples:
  qc changeset                     # changeset from commits vs main
  qc changeset --base develop      # compare against develop
`;

const HELP_BRANCH = `qc branch — Generate and create a branch with an AI-generated name

Usage:
  qc branch                     Name from staged/unstaged diff
  qc branch <name>              Use explicit name (skip AI)
  qc branch --message "..."     Name from a description (no diff needed)
  qc branch --from-commits      Name from recent commit history
  qc branch --rescue            Move commits off a protected branch

Flags:
  --message <text>      Generate name from a description
  --from-commits        Use commit log instead of diff for naming
  --rescue              Move existing commits off protected branch to new branch
  --no-switch           Create branch but don't checkout
  --from <ref>          Base from this ref (default: HEAD)
  -p, --push            Push immediately and set upstream
  -n, --dry-run         Show generated name without creating

Examples:
  qc branch                         # name from current changes
  qc branch -m "add oauth login"    # name from description
  qc branch feat/my-feature         # explicit name
  qc branch --rescue                # move commits off main
  qc branch -np                     # dry-run (show name only)
`;


export interface ParsedArgs {
  command:
    | "commit"
    | "login"
    | "logout"
    | "status"
    | "pr"
    | "changelog"
    | "init"
    | "team"
    | "config"
    | "upgrade"
    | "changeset"
    | "branch"
    | "help";
  all: boolean;
  messageOnly: boolean;
  push: boolean;
  verbose: boolean;
  quiet: boolean;
  dryRun: boolean;
  interactive: boolean;
  split: boolean;
  forceBody: boolean;
  confirm: boolean;
  noContext: boolean;
  noSmartDiff: boolean;
  local: boolean;
  apiKey?: string;
  base?: string;
  create?: boolean;
  from?: string;
  to?: string;
  write?: boolean;
  version?: string;
  uninstall?: boolean;
  hookMode?: boolean;
  model?: string;
  type?: string;
  scope?: string;
  exclude: string[];
  setProvider?: "ollama" | "lmstudio" | "openrouter" | "cloudflare";
  positionals: string[];
  message?: string;
  fromCommits?: boolean;
  rescue?: boolean;
  noSwitch?: boolean;
  allowProtected?: boolean;
  autoBranch?: boolean;
  noAnimate?: boolean;
  boxStyleOverride?: "rounded" | "gradient" | "double" | "none";
  helpFor?: string;
}

const SHORT_FLAGS: Record<string, keyof ParsedArgs> = {
  p: "push",
  a: "all",
  m: "messageOnly",
  v: "verbose",
  q: "quiet",
  n: "dryRun",
  i: "interactive",
  s: "split",
  b: "forceBody",
  l: "local",
  c: "confirm",
};

const SHORT_FLAGS_WITH_VALUE: Record<string, keyof ParsedArgs> = {
  t: "type",
  S: "scope",
  e: "exclude",
};

export function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "commit",
    all: false,
    messageOnly: false,
    push: false,
    verbose: false,
    quiet: false,
    dryRun: false,
    interactive: false,
    split: false,
    forceBody: false,
    confirm: false,
    noContext: false,
    noSmartDiff: false,
    local: false,
    exclude: [],
    positionals: [],
  };

  let subcommandSeen = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    // Composed short flags: -ap, -apv, etc.
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 2) {
      const chars = [...arg.slice(1)];
      for (let j = 0; j < chars.length; j++) {
        const ch = chars[j];
        if (!ch) continue;
        if (SHORT_FLAGS[ch]) {
          const key = SHORT_FLAGS[ch];
          (result as unknown as Record<string, unknown>)[key] = true;
        } else if (SHORT_FLAGS_WITH_VALUE[ch]) {
          if (j < chars.length - 1) {
            throw new Error(`Flag -${ch} requires a value and must be last in a composed group`);
          }
          const val = args[++i];
          if (!val || (val.startsWith("-") && val.length > 1)) throw new Error(`Flag -${ch} requires a value`);
          const key = SHORT_FLAGS_WITH_VALUE[ch];
          if (key === "exclude") {
            result.exclude.push(val);
          } else {
            (result as unknown as Record<string, unknown>)[key] = val;
          }
        } else if (ch === "h") {
          if (result.command !== "commit") result.helpFor = result.command;
          result.command = "help";
        } else {
          throw new Error(`Unknown flag: -${ch}`);
        }
      }
      continue;
    }

    // Single short flags
    if (arg.length === 2 && arg.startsWith("-") && !arg.startsWith("--")) {
      const ch = arg[1];
      if (!ch) continue;
      if (SHORT_FLAGS[ch]) {
        (result as unknown as Record<string, unknown>)[SHORT_FLAGS[ch]] = true;
        continue;
      }
      if (SHORT_FLAGS_WITH_VALUE[ch]) {
        const val = args[++i];
        if (!val || (val.startsWith("-") && val.length > 1)) {
          throw new Error(`Flag -${ch} requires a value`);
        }
        const key = SHORT_FLAGS_WITH_VALUE[ch];
        if (key === "exclude") {
          result.exclude.push(val);
        } else {
          (result as unknown as Record<string, unknown>)[key] = val;
        }
        continue;
      }
      if (ch === "h") {
        if (result.command !== "commit") result.helpFor = result.command;
        result.command = "help";
        continue;
      }
      throw new Error(`Unknown flag: -${ch}`);
    }

    // Long flags
    if (arg === "--help") {
      if (result.command !== "commit") result.helpFor = result.command;
      result.command = "help";
    } else if (arg === "--all") {
      result.all = true;
    } else if (arg === "--allow-protected") {
      result.allowProtected = true;
    } else if (arg === "--auto-branch") {
      result.autoBranch = true;
    } else if (arg === "--message-only") {
      result.messageOnly = true;
    } else if (arg === "--message" && i + 1 < args.length) {
      result.message = args[++i];
    } else if (arg === "--message") {
      throw new Error("Flag --message requires a value");
    } else if (arg === "--push") {
      result.push = true;
    } else if (arg === "--rescue") {
      result.rescue = true;
    } else if (arg === "--verbose") {
      result.verbose = true;
    } else if (arg === "--quiet") {
      result.quiet = true;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--interactive") {
      result.interactive = true;
    } else if (arg === "--split") {
      result.split = true;
    } else if (arg === "--body") {
      result.forceBody = true;
    } else if (arg === "--confirm") {
      result.confirm = true;
    } else if (arg === "--no-confirm") {
      result.confirm = false;
    } else if (arg === "--no-context") {
      result.noContext = true;
    } else if (arg === "--no-smart-diff") {
      result.noSmartDiff = true;
    } else if (arg === "--no-switch") {
      result.noSwitch = true;
    } else if (
      arg === "--local" ||
      arg === "--use-ollama" ||
      arg === "--use-lmstudio" ||
      arg === "--use-openrouter" ||
      arg === "--use-cloudflare"
    ) {
      result.local = true;
      if (arg === "--use-ollama") {
        result.setProvider = "ollama";
      } else if (arg === "--use-lmstudio") {
        result.setProvider = "lmstudio";
      } else if (arg === "--use-openrouter") {
        result.setProvider = "openrouter";
      } else if (arg === "--use-cloudflare") {
        result.setProvider = "cloudflare";
      }
    } else if (arg === "--api-key" && i + 1 < args.length) {
      result.apiKey = args[++i];
    } else if (arg === "--api-key") {
      throw new Error("Flag --api-key requires a value");
    } else if (arg === "--base" && i + 1 < args.length) {
      result.base = args[++i];
    } else if (arg === "--base") {
      throw new Error("Flag --base requires a value");
    } else if (arg === "--create") {
      result.create = true;
    } else if (arg === "--from" && i + 1 < args.length) {
      result.from = args[++i];
    } else if (arg === "--from") {
      throw new Error("Flag --from requires a value");
    } else if (arg === "--from-commits") {
      result.fromCommits = true;
    } else if (arg === "--to" && i + 1 < args.length) {
      result.to = args[++i];
    } else if (arg === "--to") {
      throw new Error("Flag --to requires a value");
    } else if (arg === "--write") {
      result.write = true;
    } else if (arg === "--version" && i + 1 < args.length) {
      result.version = args[++i];
    } else if (arg === "--version") {
      throw new Error("Flag --version requires a value");
    } else if (arg === "--uninstall") {
      result.uninstall = true;
    } else if (arg === "--hook-mode") {
      result.hookMode = true;
    } else if (arg === "--model" && i + 1 < args.length) {
      result.model = args[++i];
    } else if (arg === "--model") {
      throw new Error("Flag --model requires a value");
    } else if (arg === "--type" && i + 1 < args.length) {
      result.type = args[++i];
    } else if (arg === "--type") {
      throw new Error("Flag --type requires a value");
    } else if (arg === "--scope" && i + 1 < args.length) {
      result.scope = args[++i];
    } else if (arg === "--scope") {
      throw new Error("Flag --scope requires a value");
    } else if (arg === "--exclude" && i + 1 < args.length) {
      const ex = args[++i];
      if (ex) result.exclude.push(ex);
    } else if (arg === "--exclude") {
      throw new Error("Flag --exclude requires a value");
    } else if (arg === "--no-color") {
      /* handled in ui.ts via argv / env */
    } else if (arg === "--no-animate") {
      result.noAnimate = true;
    } else if (arg === "--style" && i + 1 < args.length) {
      const v = args[++i];
      if (v !== "rounded" && v !== "gradient" && v !== "double" && v !== "none") {
        throw new Error(
          `Invalid --style value: ${v}. Must be: rounded | gradient | double | none.`
        );
      }
      result.boxStyleOverride = v;
    } else if (arg === "--style") {
      throw new Error("Flag --style requires a value");
    } else if (arg === "login") {
      result.command = "login";
      subcommandSeen = true;
    } else if (arg === "logout") {
      result.command = "logout";
      subcommandSeen = true;
    } else if (arg === "status") {
      result.command = "status";
      subcommandSeen = true;
    } else if (arg === "pr") {
      result.command = "pr";
      subcommandSeen = true;
    } else if (arg === "changelog") {
      result.command = "changelog";
      subcommandSeen = true;
    } else if (arg === "branch") {
      result.command = "branch";
      subcommandSeen = true;
    } else if (arg === "init") {
      result.command = "init";
      subcommandSeen = true;
    } else if (arg === "team") {
      result.command = "team";
      subcommandSeen = true;
    } else if (arg === "config") {
      result.command = "config";
      subcommandSeen = true;
    } else if (arg === "upgrade") {
      result.command = "upgrade";
      subcommandSeen = true;
    } else if (arg === "changeset") {
      result.command = "changeset";
      subcommandSeen = true;
    } else if (subcommandSeen && !arg.startsWith("-")) {
      result.positionals.push(arg);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else if (!subcommandSeen) {
      throw new Error(`Unknown command: ${arg}. Run 'qc --help' for usage.`);
    }
  }

  if (result.messageOnly && result.push) {
    throw new Error("Cannot combine --message-only (-m) with --push (-p)");
  }
  if (result.quiet && result.verbose) {
    throw new Error("Cannot combine --quiet (-q) with --verbose (-v)");
  }
  if (result.dryRun && result.push) {
    throw new Error("Cannot combine --dry-run (-n) with --push (-p). Pick one.");
  }

  return result;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let values: ParsedArgs;
  try {
    values = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const { command, apiKey } = values;

  if (command === "help") {
    const subHelp: Record<string, string> = {
      pr: HELP_PR,
      changelog: HELP_CHANGELOG,
      changeset: HELP_CHANGESET,
      branch: HELP_BRANCH,
    };
    console.log(values.helpFor && subHelp[values.helpFor] ? subHelp[values.helpFor] : HELP);
    return;
  }

  // Apply provider config side effects here (after help/dispatch, before any command runs).
  // This ensures --use-* flags don't mutate config when combined with --help.
  if (values.setProvider) {
    switch (values.setProvider) {
      case "ollama":
        saveConfig({ ...getConfig(), provider: "ollama", apiUrl: "http://localhost:11434", model: "codellama" });
        break;
      case "lmstudio":
        saveConfig({ ...getConfig(), provider: "lmstudio", apiUrl: "http://localhost:1234/v1", model: "default" });
        break;
      case "openrouter":
        saveConfig({
          ...getConfig(),
          provider: "openrouter",
          apiUrl: "https://openrouter.ai/api/v1",
          model: "google/gemini-flash-1.5-8b",
        });
        break;
      case "cloudflare":
        saveConfig({
          ...getConfig(),
          provider: "cloudflare",
          apiUrl: "https://YOUR-WORKER.workers.dev",
          model: "@cf/qwen/qwen2.5-coder-32b-instruct",
        });
        console.error("[qc] Cloudflare provider set. Run: qc config set api_url https://your-worker.workers.dev");
        break;
    }
  }

  if (command === "login") {
    const { runLogin } = await import("./commands/login.js");
    await runLogin();
    return;
  }

  if (command === "logout") {
    const { runLogout } = await import("./commands/logout.js");
    runLogout();
    return;
  }

  if (command === "status") {
    const { runStatus } = await import("./commands/status.js");
    await runStatus(apiKey);
    return;
  }

  if (command === "pr") {
    const { pr } = await import("./commands/pr.js");
    await pr({
      base: values.base,
      create: values.create,
      model: values.model ?? getConfig().model,
    });
    return;
  }

  if (command === "changelog") {
    const { changelog } = await import("./commands/changelog.js");
    await changelog({
      from: values.from,
      to: values.to,
      write: values.write,
      version: values.version,
      model: values.model ?? getConfig().model,
    });
    return;
  }

  if (command === "changeset") {
    const { changeset } = await import("./commands/changeset.js");
    await changeset({
      base: values.base,
      model: values.model ?? getConfig().model,
    });
    return;
  }

  if (command === "branch") {
    const { runBranch } = await import("./commands/branch.js");
    const explicitName = values.positionals[0];
    await runBranch({
      explicitName,
      message: values.message,
      fromCommits: values.fromCommits,
      rescue: values.rescue,
      dryRun: values.dryRun,
      noSwitch: values.noSwitch,
      push: values.push,
      from: values.from,
      model: values.model,
      apiKey: values.apiKey,
      noAnimate: values.noAnimate,
    });
    return;
  }

  if (command === "init") {
    const { init } = await import("./commands/init.js");
    init({ uninstall: values.uninstall });
    return;
  }

  if (command === "team") {
    const { team } = await import("./commands/team.js");
    await team(values.positionals[0], values.positionals.slice(1));
    return;
  }

  if (command === "config") {
    const { config } = await import("./commands/config.js");
    config(values.positionals);
    return;
  }

  if (command === "upgrade") {
    const { upgrade } = await import("./commands/upgrade.js");
    await upgrade();
    return;
  }

  // Local mode: explicit flag OR configured local provider takes priority over SaaS.
  // This prevents sending local model names (e.g. "default") to the SaaS gateway.
  if (values.local) {
    // Explicit --local / --use-ollama / etc — lazy import justified: avoids loading
    // 737-line local.ts when user is in SaaS mode (majority case).
    const { runLocalCommit } = await import("./local.js");
    await runLocalCommit(values);
    return;
  }

  {
    // Auto-detect: if a local provider is configured, use it even if logged in to SaaS.
    // Lazy import justified: same reason — skip loading local.ts for SaaS-only users.
    const { getLocalProviderConfig } = await import("./local.js");
    if (getLocalProviderConfig()) {
      const { runLocalCommit } = await import("./local.js");
      await runLocalCommit(values);
      return;
    }
  }

  // SaaS mode — no local provider configured.
  const { runCommit } = await import("./commands/commit.js");
  await runCommit(values);
}

main().catch((err) => {
  const args = process.argv.slice(2);
  const hookMode = args.includes("--hook-mode");
  if (!hookMode) {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
