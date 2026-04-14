import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import type { CommitRules } from "@quikcommit/shared";
import { getGitRoot } from "./git.js";

/**
 * Resolution order for commitlint config (first match in repo root):
 * 1) npx commitlint --print-config (handles JS/TS/YAML/extends; needs network first npx run unless cached)
 * 2) node ESM eval for .mjs/.js/.cjs (file URL import — safe for paths with quotes/spaces)
 * 3) node --experimental-strip-types for .commitlint.config.ts (Node 22+), then npx tsx fallback
 * 4) YAML parse for .commitlintrc.yml / .yaml (no npx)
 * 5) JSON parse for .commitlintrc.json and extensionless .commitlintrc
 *
 * .yml/.yaml without npx are covered by step 4; if that fails, step 1 may still succeed when online.
 */
const CONFIG_FILES = [
  "commitlint.config.mjs",
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.ts",
  ".commitlintrc.json",
  ".commitlintrc",
  ".commitlintrc.yml",
  ".commitlintrc.yaml",
  ".commitlintrc.js",
  ".commitlintrc.mjs",
];

function findConfigFile(root: string): string | null {
  for (const file of CONFIG_FILES) {
    const full = join(root, file);
    if (existsSync(full)) return full;
  }
  return null;
}

type RuleTuple = [number, string, unknown];

function getRule(rules: Record<string, unknown>, name: string): RuleTuple | null {
  const r = rules[name];
  if (!Array.isArray(r) || r.length < 3) return null;
  const [severity, applicability, value] = r as [unknown, unknown, unknown];
  if (typeof severity !== "number" || severity < 1) return null;
  return [severity, applicability as string, value];
}

function mapRules(rules: Record<string, unknown>): CommitRules {
  const result: CommitRules = {};

  const typeEnum = getRule(rules, "type-enum");
  if (typeEnum && typeEnum[1] === "always" && Array.isArray(typeEnum[2])) {
    result.types = (typeEnum[2] as unknown[]).filter((t): t is string => typeof t === "string");
  }

  const scopeEnum = getRule(rules, "scope-enum");
  if (scopeEnum && scopeEnum[1] === "always" && Array.isArray(scopeEnum[2])) {
    result.scopes = (scopeEnum[2] as unknown[]).filter((s): s is string => typeof s === "string");
  }

  const headerMax = getRule(rules, "header-max-length");
  if (headerMax && headerMax[1] === "always" && typeof headerMax[2] === "number") {
    result.headerMaxLength = headerMax[2];
  }

  const subjectMax = getRule(rules, "subject-max-length");
  if (subjectMax && subjectMax[1] === "always" && typeof subjectMax[2] === "number") {
    result.subjectMaxLength = subjectMax[2];
  }

  const bodyMaxLine = getRule(rules, "body-max-line-length");
  if (bodyMaxLine && bodyMaxLine[1] === "always" && typeof bodyMaxLine[2] === "number") {
    result.bodyMaxLineLength = bodyMaxLine[2];
  }

  const typeCase = getRule(rules, "type-case");
  if (typeCase && typeCase[1] === "always" && (typeof typeCase[2] === "string" || Array.isArray(typeCase[2]))) {
    result.typeCase = typeCase[2] as string | string[];
  }

  const scopeCase = getRule(rules, "scope-case");
  if (scopeCase && scopeCase[1] === "always" && (typeof scopeCase[2] === "string" || Array.isArray(scopeCase[2]))) {
    result.scopeCase = scopeCase[2] as string | string[];
  }

  const subjectCase = getRule(rules, "subject-case");
  if (
    subjectCase &&
    subjectCase[1] === "always" &&
    (typeof subjectCase[2] === "string" || Array.isArray(subjectCase[2]))
  ) {
    result.subjectCase = subjectCase[2] as string | string[];
  }

  // subject-full-stop: [2, "never", "."] — subject must not end with this character
  const subjectFullStop = getRule(rules, "subject-full-stop");
  if (subjectFullStop && subjectFullStop[1] === "never" && typeof subjectFullStop[2] === "string") {
    result.subjectFullStop = subjectFullStop[2];
  }

  return result;
}

/** Returns null if rules are missing or map to an empty CommitRules (so callers can try the next strategy). */
function mapRulesToCommitRules(rules: Record<string, unknown> | undefined): CommitRules | null {
  if (!rules) return null;
  const mapped = mapRules(rules);
  return Object.keys(mapped).length > 0 ? mapped : null;
}

/** Strategy 1: use commitlint's own resolver via npx --print-config */
function tryNpxPrintConfig(root: string): CommitRules | null {
  try {
    const output = execFileSync("npx", ["--no", "commitlint", "--print-config"], {
      encoding: "utf-8",
      cwd: root,
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const config = JSON.parse(output) as { rules?: Record<string, unknown> };
    return mapRulesToCommitRules(config.rules);
  } catch {
    return null;
  }
}

/** Strategy 2: evaluate .mjs/.js/.cjs via node --input-type=module (import via file URL) */
function tryNodeEval(configPath: string): CommitRules | null {
  if (!configPath.match(/\.(mjs|js|cjs)$/)) return null;
  const fileUrl = pathToFileURL(configPath).href;
  const script = `import cfg from ${JSON.stringify(fileUrl)}; process.stdout.write(JSON.stringify(cfg.default ?? cfg));`;
  try {
    const output = execFileSync("node", ["--input-type=module"], {
      input: script,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const config = JSON.parse(output) as { rules?: Record<string, unknown> };
    return mapRulesToCommitRules(config.rules);
  } catch {
    return null;
  }
}

/** Strategy 2b: commitlint.config.ts via Node strip-types (22+) or npx tsx */
function tryNodeEvalTs(configPath: string, root: string): CommitRules | null {
  if (!configPath.endsWith(".ts")) return null;
  const fileUrl = pathToFileURL(configPath).href;
  const script = `import cfg from ${JSON.stringify(fileUrl)}; process.stdout.write(JSON.stringify(cfg.default ?? cfg));`;

  try {
    const output = execFileSync("node", ["--experimental-strip-types", "--input-type=module"], {
      input: script,
      encoding: "utf-8",
      cwd: root,
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const config = JSON.parse(output) as { rules?: Record<string, unknown> };
    const mapped = mapRulesToCommitRules(config.rules);
    if (mapped) return mapped;
  } catch {
    // Node <22 or TS features strip-types cannot handle — try tsx
  }

  try {
    const tsxScript = `import cfg from ${JSON.stringify(fileUrl)}; console.log(JSON.stringify(cfg.default ?? cfg));`;
    const output = execFileSync("npx", ["--no", "tsx", "-e", tsxScript], {
      encoding: "utf-8",
      cwd: root,
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const config = JSON.parse(output.trim()) as { rules?: Record<string, unknown> };
    return mapRulesToCommitRules(config.rules);
  } catch {
    return null;
  }
}

/** Strategy 3a: YAML commitlint configs */
function tryYamlParse(configPath: string): CommitRules | null {
  if (!configPath.endsWith(".yml") && !configPath.endsWith(".yaml")) return null;
  try {
    const content = readFileSync(configPath, "utf-8");
    const config = parseYaml(content) as { rules?: Record<string, unknown> };
    return mapRulesToCommitRules(config.rules);
  } catch {
    return null;
  }
}

/** Strategy 3b: direct JSON parse for .commitlintrc.json and bare .commitlintrc */
function tryJsonParse(configPath: string): CommitRules | null {
  if (configPath.endsWith(".yml") || configPath.endsWith(".yaml")) return null;
  if (configPath.match(/\.(mjs|js|cjs|ts)$/)) return null;
  try {
    const content = readFileSync(configPath, "utf-8");
    const config = JSON.parse(content) as { rules?: Record<string, unknown> };
    return mapRulesToCommitRules(config.rules);
  } catch {
    return null;
  }
}

function isJsOrTsConfig(configPath: string): boolean {
  return /\.(mjs|js|cjs|ts)$/.test(configPath);
}

function computeCommitlintRules(): CommitRules | undefined {
  const root = getGitRoot();
  const configPath = findConfigFile(root);
  if (!configPath) return undefined;

  // For plain JSON/YAML configs, skip the expensive npx/node subprocess strategies
  // and go straight to the parse strategies — no 10s timeout risk.
  if (!isJsOrTsConfig(configPath)) {
    return (
      tryYamlParse(configPath) ??
      tryJsonParse(configPath) ??
      undefined
    );
  }

  return (
    tryNpxPrintConfig(root) ??
    tryNodeEval(configPath) ??
    tryNodeEvalTs(configPath, root) ??
    undefined
  );
}

/**
 * Detect commitlint config in the current git repo and return mapped CommitRules.
 * Tries multiple strategies in order; silently returns undefined if all fail or no config found.
 */
export async function detectCommitlintRules(): Promise<CommitRules | undefined> {
  await Promise.resolve();
  try {
    return computeCommitlintRules();
  } catch {
    return undefined;
  }
}
