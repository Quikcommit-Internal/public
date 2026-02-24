import { getApiKey, getConfig, saveConfig } from "./config.js";
import { ApiClient } from "./api.js";
import {
  isGitRepo,
  getStagedDiff,
  getStagedFiles,
  hasStagedChanges,
  gitCommit,
  gitPush,
} from "./git.js";
import { detectWorkspace, autoDetectScope } from "./monorepo.js";

const HELP = `QuikCommit - AI-powered conventional commit messages

Usage:
  qc                    Generate commit message and commit (default)
  qc --message-only     Generate message only, print to stdout
  qc --push             Commit and push to origin
  qc pr                 Generate PR description from branch commits
  qc changelog          Generate changelog from commits since last tag
  qc changeset          Automate pnpm changeset with AI
  qc init               Install prepare-commit-msg hook for auto-generation
  qc login              Sign in via browser
  qc logout             Clear local credentials
  qc status             Show auth, plan, usage
  qc team               Team management (info, rules, invite)

Options:
  -h, --help            Show this help
  -m, --message-only    Generate message only
  -p, --push            Commit and push after generating
  --api-key <key>       Use this API key (overrides credentials file)
  --base <branch>       Base branch for qc pr, qc changeset (default: main)
  --create              Create PR with gh CLI after qc pr
  --from <ref>          Start ref for qc changelog (default: latest tag)
  --to <ref>            End ref for qc changelog (default: HEAD)
  --write               Prepend changelog to CHANGELOG.md
  --version <ver>       Version label for changelog header (default: derived from --to or "<from>-next")
  --uninstall           Remove QuikCommit hook (qc init --uninstall)
  --model <id>          Use specific model (e.g. qwen25-coder-32b, llama-3.3-70b)

Commands:
  qc config             Show current config
  qc config set <k> <v> Set config (model, api_url)
  qc config reset       Reset to defaults
  qc upgrade            Open billing page in browser
`;

function parseArgs(args: string[]): {
  command: "commit" | "login" | "logout" | "status" | "pr" | "changelog" | "init" | "team" | "config" | "upgrade" | "changeset" | "help";
  messageOnly: boolean;
  push: boolean;
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
  local?: boolean;
} {
  let command: "commit" | "login" | "logout" | "status" | "pr" | "changelog" | "init" | "team" | "config" | "upgrade" | "changeset" | "help" = "commit";
  let messageOnly = false;
  let push = false;
  let apiKey: string | undefined;
  let model: string | undefined;
  let local = false;
  let base: string | undefined;
  let create = false;
  let from: string | undefined;
  let to: string | undefined;
  let write = false;
  let version: string | undefined;
  let uninstall = false;
  let hookMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      command = "help";
    } else if (arg === "-m" || arg === "--message-only") {
      messageOnly = true;
    } else if (arg === "-p" || arg === "--push") {
      push = true;
    } else if (arg === "--api-key" && i + 1 < args.length) {
      apiKey = args[++i];
    } else if (arg === "--base" && i + 1 < args.length) {
      base = args[++i];
    } else if (arg === "--create") {
      create = true;
    } else if (arg === "--from" && i + 1 < args.length) {
      from = args[++i];
    } else if (arg === "--to" && i + 1 < args.length) {
      to = args[++i];
    } else if (arg === "--write") {
      write = true;
    } else if (arg === "--version" && i + 1 < args.length) {
      version = args[++i];
    } else if (arg === "--uninstall") {
      uninstall = true;
    } else if (arg === "--hook-mode") {
      hookMode = true;
    } else if (arg === "login") {
      command = "login";
    } else if (arg === "logout") {
      command = "logout";
    } else if (arg === "status") {
      command = "status";
    } else if (arg === "pr") {
      command = "pr";
    } else if (arg === "changelog") {
      command = "changelog";
    } else if (arg === "init") {
      command = "init";
    } else if (arg === "team") {
      command = "team";
    } else if (arg === "config") {
      command = "config";
    } else if (arg === "upgrade") {
      command = "upgrade";
    } else if (arg === "changeset") {
      command = "changeset";
    } else if (arg === "--model" && i + 1 < args.length) {
      model = args[++i];
    } else if (arg === "--local" || arg === "--use-ollama" || arg === "--use-lmstudio" || arg === "--use-openrouter" || arg === "--use-cloudflare") {
      local = true;
      if (arg === "--use-ollama") {
        saveConfig({ ...getConfig(), provider: "ollama", apiUrl: "http://localhost:11434", model: "codellama" });
      } else if (arg === "--use-lmstudio") {
        saveConfig({ ...getConfig(), provider: "lmstudio", apiUrl: "http://localhost:1234/v1", model: "default" });
      } else if (arg === "--use-openrouter") {
        saveConfig({ ...getConfig(), provider: "openrouter", apiUrl: "https://openrouter.ai/api/v1", model: "google/gemini-flash-1.5-8b" });
      } else if (arg === "--use-cloudflare") {
        saveConfig({
          ...getConfig(),
          provider: "cloudflare",
          apiUrl: "https://YOUR-WORKER.workers.dev",
          model: "@cf/qwen/qwen2.5-coder-32b-instruct",
        });
        console.error(
          "[qc] Cloudflare provider set. Run: qc config set api_url https://your-worker.workers.dev"
        );
      }
    }
  }

  return { command, messageOnly, push, apiKey, base, create, from, to, write, version, uninstall, hookMode, model, local };
}

async function runCommit(
  messageOnly: boolean,
  push: boolean,
  apiKeyFlag?: string,
  hookMode = false,
  modelFlag?: string
): Promise<void> {
  const log = hookMode ? () => {} : (msg: string) => console.error(msg);

  if (!isGitRepo()) {
    log("Error: Not a git repository.");
    process.exit(1);
  }

  if (!hasStagedChanges()) {
    log("Error: No staged changes. Stage files with `git add` first.");
    process.exit(1);
  }

  const apiKey = apiKeyFlag ?? getApiKey();
  if (!apiKey) {
    log("Error: Not authenticated. Run `qc login` first.");
    process.exit(1);
  }

  const config = getConfig();
  const model = modelFlag ?? config.model;
  const excludes = config.excludes ?? [];
  const diff = getStagedDiff(excludes);
  const changes = getStagedFiles();

  let rules = config.rules ?? {};
  const workspace = detectWorkspace();
  let monorepoScopes: string[] | undefined;
  if (workspace) {
    const stagedFiles = changes.trim().split("\n").filter(Boolean);
    const scope = autoDetectScope(stagedFiles, workspace);
    if (scope) {
      monorepoScopes = scope.split(",").map((s) => s.trim());
      rules = { ...rules, scopes: monorepoScopes };
    }
  }

  const client = new ApiClient({ apiKey });
  try {
    const teamRules = await client.getTeamRules();
    if (teamRules && Object.keys(teamRules).length > 0) {
      log("[qc] Using team rules from org");
      rules = { ...rules, ...teamRules };
      // M-3: Intersect monorepo scope with team's allowed scopes instead of replacing
      if (monorepoScopes && teamRules.scopes && teamRules.scopes.length > 0) {
        const allowed = new Set(teamRules.scopes);
        const intersected = monorepoScopes.filter((s) => allowed.has(s));
        if (intersected.length > 0) rules = { ...rules, scopes: intersected };
      }
    }
  } catch {
    // Not in a team or API error - use local rules only
  }

  const { message } = await client.generateCommit(diff, changes, rules, model);

  if (messageOnly) {
    console.log(message);
    return;
  }

  gitCommit(message);
  if (push) {
    gitPush();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const values = parseArgs(argv);
  const { command, messageOnly, push, apiKey } = values;

  if (command === "help") {
    console.log(HELP);
    return;
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

  if (command === "init") {
    const { init } = await import("./commands/init.js");
    await init({ uninstall: values.uninstall });
    return;
  }

  if (command === "team") {
    const { team } = await import("./commands/team.js");
    const positionals = argv.filter((a) => !a.startsWith("-") && a !== "team");
    await team(positionals[0], positionals.slice(1));
    return;
  }

  if (command === "config") {
    const { config } = await import("./commands/config.js");
    const positionals = argv.filter((a) => !a.startsWith("-") && a !== "config");
    await config(positionals);
    return;
  }

  if (command === "upgrade") {
    const { upgrade } = await import("./commands/upgrade.js");
    await upgrade();
    return;
  }

  // Local mode: use provider directly (--local or --use-ollama etc.)
  if (values.local) {
    const { runLocalCommit } = await import("./local.js");
    await runLocalCommit(messageOnly, push, values.model);
    return;
  }

  // Auto-fallback: no API key but local provider configured
  const apiKeyToUse = apiKey ?? getApiKey();
  if (!apiKeyToUse) {
    const { getLocalProviderConfig } = await import("./local.js");
    if (getLocalProviderConfig()) {
      const { runLocalCommit } = await import("./local.js");
      await runLocalCommit(messageOnly, push, values.model);
      return;
    }
  }

  await runCommit(messageOnly, push, apiKey, values.hookMode, values.model);
}

main().catch((err) => {
  const args = process.argv.slice(2);
  const hookMode = args.includes("--hook-mode");
  if (!hookMode) {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
