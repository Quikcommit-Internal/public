import { estimateTokens } from "@quikcommit/shared";

function sanitizeFilepath(path: string): string {
  // Strip control chars, newlines, and characters that break our summary format
  // eslint-disable-next-line no-control-regex
  return path.replace(/[\x00-\x1F\x7F[\]`]/g, "_").slice(0, 200);
}

type FileClass = "lock" | "generated" | "sourcemap" | "vendored" | "minified" | "code";

const LOCK_FILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
  "bun.lockb",
  "shrinkwrap.json",
]);

const GENERATED_PATTERNS = [
  /\.generated\.\w+$/,
  /\.g\.dart$/,
  /\.pb\.go$/,
  /\.pb\.ts$/,
  /(^|\/)\.prisma\/client\//,
  /\/generated\//,
];

const VENDORED_PREFIXES = ["vendor/", "third_party/", "node_modules/"];

export function classifyFile(filepath: string): FileClass {
  const basename = filepath.split("/").pop() ?? filepath;

  if (LOCK_FILES.has(basename)) return "lock";
  if (filepath.endsWith(".map")) return "sourcemap";
  if (VENDORED_PREFIXES.some((p) => filepath.startsWith(p))) return "vendored";
  if (GENERATED_PATTERNS.some((p) => p.test(filepath))) return "generated";

  return "code";
}

interface FileDiff {
  filepath: string;
  content: string;
  additions: number;
  deletions: number;
}

function parseDiffIntoFiles(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const parts = diff.split(/^(diff --git .+)$/m);

  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i];
    const content = parts[i + 1] ?? "";
    const match = header.match(/diff --git a\/(.+?) b\/(.+)/);
    const filepath = match?.[2] ?? "unknown";

    const lines = content.split("\n");
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({ filepath, content: header + content, additions, deletions });
  }

  return files;
}

function isMinified(content: string): boolean {
  const lines = content.split("\n").filter(
    (l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---")
  );
  if (lines.length === 0) return false;
  return lines.some((l) => l.length > 500);
}

export interface SmartDiffResult {
  processedDiff: string;
  summarized: string[];
  tokensSaved: number;
}

export function preprocessDiff(diff: string): SmartDiffResult {
  const files = parseDiffIntoFiles(diff);
  if (files.length === 0) return { processedDiff: diff, summarized: [], tokensSaved: 0 };

  const kept: string[] = [];
  const summarized: string[] = [];
  let tokensSaved = 0;

  for (const file of files) {
    const classification = classifyFile(file.filepath);

    switch (classification) {
      case "sourcemap":
        tokensSaved += estimateTokens(file.content);
        summarized.push(file.filepath);
        break;

      case "lock":
        tokensSaved += estimateTokens(file.content);
        kept.push(`[lock file updated: ${sanitizeFilepath(file.filepath)} (+${file.additions} −${file.deletions} lines)]\n`);
        summarized.push(file.filepath);
        break;

      case "generated":
        tokensSaved += estimateTokens(file.content);
        kept.push(`[generated: ${sanitizeFilepath(file.filepath)} (+${file.additions} −${file.deletions})]\n`);
        summarized.push(file.filepath);
        break;

      case "vendored":
        tokensSaved += estimateTokens(file.content);
        kept.push(`[vendored: ${sanitizeFilepath(file.filepath)} updated]\n`);
        summarized.push(file.filepath);
        break;

      case "code":
        if (isMinified(file.content)) {
          tokensSaved += estimateTokens(file.content);
          const sizeKB = Math.round(file.content.length / 1024);
          kept.push(`[minified asset: ${sanitizeFilepath(file.filepath)} (${sizeKB} KB)]\n`);
          summarized.push(file.filepath);
        } else {
          kept.push(file.content);
        }
        break;
    }
  }

  return {
    processedDiff: kept.join(""),
    summarized,
    tokensSaved,
  };
}
