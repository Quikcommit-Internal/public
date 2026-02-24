import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import * as readline from "readline";
import { getApiKey } from "../config.js";
import { ApiClient } from "../api.js";
import {
  getGitRoot,
  getChangedFilesSince,
  getOnlineLog,
  getFullDiff,
} from "../git.js";
import { getPackageForFile } from "../monorepo.js";
import type { WorkspaceInfo } from "../monorepo.js";

// ---------------------------------------------------------------------------
// Slug generation — 3-word adjective-animal-verb (matches changesets' style)
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  "bouncy", "brave", "calm", "clean", "cool", "damp", "epic", "fair",
  "fast", "firm", "flat", "free", "glad", "gold", "good", "gray", "huge",
  "keen", "kind", "lazy", "lean", "lush", "mild", "neat", "nice", "noble",
  "pure", "rare", "rich", "safe", "sharp", "slim", "slow", "soft", "swift",
  "tall", "tame", "tidy", "tiny", "tough", "trim", "true", "vast", "warm",
  "wild", "wise",
];
const ANIMALS = [
  "ant", "bear", "bee", "bird", "bug", "cat", "crab", "crow", "deer",
  "dog", "dove", "duck", "elk", "fish", "frog", "goat", "hawk", "lamb",
  "lark", "lion", "lynx", "mole", "moth", "mule", "owl", "pony", "puma",
  "raven", "slug", "snail", "swan", "toad", "vole", "wasp", "wolf", "wren",
  "yak",
];
const VERBS = [
  "bite", "bolt", "burn", "buzz", "call", "cast", "chase", "chew", "claw",
  "climb", "crawl", "dart", "dash", "dive", "draw", "drift", "drop", "eat",
  "fall", "find", "flee", "flip", "flow", "fly", "glow", "gnaw", "growl",
  "howl", "hunt", "jump", "kick", "leap", "lick", "lift", "lurk", "pace",
  "peck", "play", "race", "roam", "roar", "roll", "run", "skim", "sniff",
  "soar", "spin", "swim", "wade", "walk",
];

export function generateSlug(): string {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${pick(VERBS)}`;
}

// ---------------------------------------------------------------------------
// Package detection
// ---------------------------------------------------------------------------

/**
 * Map changed file paths to workspace package names.
 * Returns a Map<directoryName, packageName> where packageName comes from
 * reading the package.json in that directory (falls back to dirName).
 */
export function mapFilesToPackages(
  files: string[],
  workspace: WorkspaceInfo
): Map<string, string> {
  const dirToName = new Map<string, string>();

  for (const file of files) {
    const dirName = getPackageForFile(file, workspace);
    if (!dirName || dirToName.has(dirName)) continue;

    // Attempt to read the package.json for the real scoped name
    for (const pattern of workspace.packages) {
      const hasGlob = /\*/.test(pattern);
      const dir = pattern.replace(/\/?\*\*?$/, "").replace(/\/$/, "");
      // For "packages/*", dir=packages, dirName=cli → root/packages/cli/package.json
      // For "packages/cli" (no glob), package root is pattern → root/packages/cli/package.json
      const pkgJsonPath = hasGlob
        ? join(workspace.root, dir, dirName, "package.json")
        : join(workspace.root, pattern.replace(/\/$/, ""), "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
          name?: string;
        };
        dirToName.set(dirName, pkg.name ?? dirName);
        break;
      } catch {
        // try next pattern
      }
    }

    // Fallback: use the directory name as the package identifier
    if (!dirToName.has(dirName)) {
      dirToName.set(dirName, dirName);
    }
  }

  return dirToName;
}

// ---------------------------------------------------------------------------
// Changeset file formatting
// ---------------------------------------------------------------------------

export function formatChangesetFile(
  packages: Array<{ name: string; bump: string }>,
  summary: string
): string {
  const frontmatter = packages.map((p) => `"${p.name}": ${p.bump}`).join("\n");
  return `---\n${frontmatter}\n---\n\n${summary}\n`;
}

// ---------------------------------------------------------------------------
// Interactive prompt helper
// ---------------------------------------------------------------------------

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function changeset(options: {
  base?: string;
  model?: string;
}): Promise<void> {
  const base = options.base ?? "main";

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("Error: Not authenticated. Run `qc login` first.");
    process.exit(1);
  }

  const { detectWorkspace } = await import("../monorepo.js");
  const workspace = detectWorkspace();
  if (!workspace) {
    console.error(
      "No workspace packages found. Is this a pnpm monorepo?"
    );
    process.exit(1);
  }

  const changedFiles = getChangedFilesSince(base);
  if (changedFiles.length === 0) {
    console.error(`No changes detected vs ${base}.`);
    process.exit(1);
  }

  const packageMap = mapFilesToPackages(changedFiles, workspace);
  const packageNames = Array.from(packageMap.values());

  if (packageNames.length === 0) {
    console.error("No workspace packages detected in changed files.");
    process.exit(1);
  }

  const commits = getOnlineLog(base);
  const diff = getFullDiff(base);
  const commitCount = commits.split("\n").filter(Boolean).length;

  console.error(
    `Analyzing changes vs ${base}... ${commitCount} commit(s), ${packageNames.length} package(s) changed`
  );

  const client = new ApiClient({ apiKey });

  type ChangesetPkg = {
    name: string;
    bump: "major" | "minor" | "patch";
    reason: string;
  };
  let result: { packages: ChangesetPkg[]; summary: string };

  // Retry once on transient failures only (e.g. AI JSON parse errors, 5xx)
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const isTransient = (m: string) =>
    /invalid json|no changeset|unexpected response|ai worker|timeout|502|503|504/i.test(m);
  let attempts = 0;
  while (true) {
    try {
      result = await client.generateChangeset({
        diff,
        packages: packageNames,
        commits,
        model: options.model,
      });
      break;
    } catch (err) {
      const m = msg(err);
      if (!isTransient(m)) {
        console.error(m);
        process.exit(1);
      }
      if (attempts === 0) {
        attempts++;
        continue;
      }
      console.error(m);
      process.exit(1);
    }
  }

  // Ensure every detected package is represented (AI may have missed some)
  const resultNames = new Set(result.packages.map((p) => p.name));
  for (const name of packageNames) {
    if (!resultNames.has(name)) {
      result.packages.push({ name, bump: "patch", reason: "included in changeset" });
    }
  }

  // Display suggestions
  console.log("");
  for (const pkg of result.packages) {
    console.log(`  ${pkg.name.padEnd(32)} ${pkg.bump.padEnd(7)} — ${pkg.reason}`);
  }
  console.log("");
  console.log(`Summary: ${result.summary}`);
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (
      await prompt(rl, "Accept all? [Y/n/edit] > ")
    ).trim().toLowerCase();

    if (answer === "n") {
      console.error("Aborted.");
      process.exit(0);
    }

    if (answer === "edit") {
      for (let i = 0; i < result.packages.length; i++) {
        const pkg = result.packages[i];
        const response = (
          await prompt(rl, `  ${pkg.name} [${pkg.bump}]: major/minor/patch? > `)
        ).trim().toLowerCase();
        if (response === "major" || response === "minor" || response === "patch") {
          result.packages[i] = { ...pkg, bump: response };
        }
        // Enter (empty string) keeps existing value
      }
    }
  } finally {
    rl.close();
  }

  // Write the changeset file
  const slug = generateSlug();
  const gitRoot = getGitRoot();
  const changesetDir = join(gitRoot, ".changeset");
  if (!existsSync(changesetDir)) {
    mkdirSync(changesetDir, { recursive: true });
  }
  const filePath = join(changesetDir, `${slug}.md`);
  const content = formatChangesetFile(result.packages, result.summary);
  writeFileSync(filePath, content, "utf-8");

  console.log(`\n✓ Written .changeset/${slug}.md`);
}
