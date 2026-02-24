import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { ApiClient } from "../api.js";
import { getConfig } from "../config.js";
import type { CommitRules } from "@quikcommit/shared";

function createApiClient(): ApiClient {
  return new ApiClient();
}

/** Map commitlint config format to CommitRules */
function mapCommitlintToRules(config: unknown): CommitRules | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  const rules: CommitRules = {};

  const _ext = c.extends as string[] | undefined;
  const rulesConfig = c.rules as Record<string, unknown> | undefined;

  // Commitlint format: [level, applicability, value] — index 2 is the value
  if (Array.isArray(rulesConfig?.["type-enum"]) && rulesConfig["type-enum"].length >= 3) {
    const [, , value] = rulesConfig["type-enum"] as [number, string, string[]];
    if (Array.isArray(value)) rules.types = value;
  }
  if (Array.isArray(rulesConfig?.["scope-enum"]) && rulesConfig["scope-enum"].length >= 3) {
    const [, , value] = rulesConfig["scope-enum"] as [number, string, string[]];
    if (Array.isArray(value)) rules.scopes = value;
  }
  if (Array.isArray(rulesConfig?.["header-max-length"]) && rulesConfig["header-max-length"].length >= 3) {
    const [, , maxLen] = rulesConfig["header-max-length"] as [number, string, number];
    if (typeof maxLen === "number") rules.headerMaxLength = maxLen;
  }
  if (Array.isArray(rulesConfig?.["subject-case"]) && rulesConfig["subject-case"].length >= 3) {
    const [, , val] = rulesConfig["subject-case"] as [number, string, string | string[]];
    if (val != null) rules.subjectCase = Array.isArray(val) ? val : [val];
  }

  return Object.keys(rules).length > 0 ? rules : null;
}

/** Detect and parse local commitlint config (project files first, then ~/.config/qc) */
function detectLocalCommitlintRules(): CommitRules | null {
  const cwd = process.cwd();
  const files = [
    ".commitlintrc.json",
    ".commitlintrc",
    "commitlint.config.js",
    "commitlint.config.cjs",
    "commitlint.config.mjs",
  ];

  for (const file of files) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf-8");
      let parsed: unknown;
      if (file.endsWith(".json") || file === ".commitlintrc") {
        parsed = JSON.parse(content);
      } else {
        // Skip .js/.cjs/.mjs - would need dynamic import
        continue;
      }
      const rules = mapCommitlintToRules(parsed);
      if (rules) return rules;
    } catch {
      // Ignore parse errors
    }
  }

  // Check package.json commitlint
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(content) as { commitlint?: unknown };
      if (pkg.commitlint) {
        const rules = mapCommitlintToRules(pkg.commitlint);
        if (rules) return rules;
      }
    } catch {
      // Ignore
    }
  }

  const config = getConfig();
  if (config.rules && Object.keys(config.rules).length > 0) {
    return config.rules;
  }

  return null;
}

export async function team(subcommand?: string, args?: string[]): Promise<void> {
  const api = createApiClient();

  switch (subcommand) {
    case undefined:
    case "info": {
      const info = await api.getTeam();
      console.log(`\n  Team: ${info.name}`);
      console.log(`  Plan: ${info.plan}`);
      console.log(`  Members: ${info.member_count}`);
      console.log("\n  Members:");
      for (const m of info.members) {
        console.log(`    ${m.name ?? m.email} <${m.email}> (${m.role})`);
      }
      break;
    }

    case "rules": {
      if (args?.[0] === "push") {
        const rules = detectLocalCommitlintRules();
        if (!rules) {
          console.error("No local commitlint config found.");
          process.exit(1);
        }
        await api.pushTeamRules(rules);
        console.log("Team rules updated from local commitlint config.");
      } else {
        const rules = await api.getTeamRules();
        console.log("\n  Team Commit Rules:");
        console.log(JSON.stringify(rules, null, 2));
      }
      break;
    }

    case "invite": {
      const email = args?.[0];
      if (!email) {
        console.error("Usage: qc team invite <email>");
        process.exit(1);
      }
      await api.inviteTeamMember(email);
      console.log(`Invitation sent to ${email}`);
      break;
    }

    default:
      console.error(`Unknown team command: ${subcommand}`);
      console.log("Usage: qc team [info|rules|rules push|invite <email>]");
      process.exit(1);
  }
}
