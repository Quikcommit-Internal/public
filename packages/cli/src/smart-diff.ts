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
  aggressivelySummarized: string[]; // files summarized due to size budget (not noise classification)
  tokensSaved: number;
}

export function preprocessDiff(diff: string): SmartDiffResult {
  const files = parseDiffIntoFiles(diff);
  if (files.length === 0) return { processedDiff: diff, summarized: [], aggressivelySummarized: [], tokensSaved: 0 };

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
    aggressivelySummarized: [],
    tokensSaved,
  };
}

/**
 * Produces a one-line summary placeholder for a code file that was too large
 * to include inline.
 */
function buildFileSummary(file: FileDiff): string {
  const sizeKB = Math.round(file.content.length / 1024);
  return `[modified: ${sanitizeFilepath(file.filepath)} — +${file.additions} −${file.deletions} lines, ~${sizeKB}KB]\n`;
}

/**
 * Variant of preprocessDiff that applies a two-tier aggressive size-budget
 * reduction on top of the normal noise-file summarization.
 *
 * After the standard preprocessDiff pass, if the remaining diff still exceeds
 * `maxBytes`, it applies:
 *   - Tier 1: summarize all "code" files whose raw content exceeds 5 KB
 *   - Tier 2: if still over budget, summarize all "code" files exceeding 2 KB
 *   - Final fallback: replace ALL remaining code file content with summaries
 *
 * Files aggressively summarized in any tier are reported in
 * `aggressivelySummarized`.
 *
 * @param diff     Raw git diff string
 * @param maxBytes Budget in bytes for the processedDiff output (default 5 MB)
 */
export function preprocessDiffWithSizeBudget(
  diff: string,
  maxBytes = 5 * 1024 * 1024
): SmartDiffResult {
  const files = parseDiffIntoFiles(diff);
  if (files.length === 0) {
    return { processedDiff: diff, summarized: [], aggressivelySummarized: [], tokensSaved: 0 };
  }

  // Phase 1: standard noise classification (identical to preprocessDiff)
  type FileEntry = { file: FileDiff; isNoise: boolean; summaryLine: string | null };
  const entries: FileEntry[] = [];
  const summarized: string[] = [];
  let tokensSaved = 0;

  for (const file of files) {
    const classification = classifyFile(file.filepath);
    switch (classification) {
      case "sourcemap":
        tokensSaved += estimateTokens(file.content);
        summarized.push(file.filepath);
        entries.push({ file, isNoise: true, summaryLine: null });
        break;
      case "lock":
        tokensSaved += estimateTokens(file.content);
        summarized.push(file.filepath);
        entries.push({
          file,
          isNoise: true,
          summaryLine: `[lock file updated: ${sanitizeFilepath(file.filepath)} (+${file.additions} −${file.deletions} lines)]\n`,
        });
        break;
      case "generated":
        tokensSaved += estimateTokens(file.content);
        summarized.push(file.filepath);
        entries.push({
          file,
          isNoise: true,
          summaryLine: `[generated: ${sanitizeFilepath(file.filepath)} (+${file.additions} −${file.deletions})]\n`,
        });
        break;
      case "vendored":
        tokensSaved += estimateTokens(file.content);
        summarized.push(file.filepath);
        entries.push({
          file,
          isNoise: true,
          summaryLine: `[vendored: ${sanitizeFilepath(file.filepath)} updated]\n`,
        });
        break;
      case "code":
        if (isMinified(file.content)) {
          tokensSaved += estimateTokens(file.content);
          const sizeKB = Math.round(file.content.length / 1024);
          summarized.push(file.filepath);
          entries.push({
            file,
            isNoise: true,
            summaryLine: `[minified asset: ${sanitizeFilepath(file.filepath)} (${sizeKB} KB)]\n`,
          });
        } else {
          entries.push({ file, isNoise: false, summaryLine: null });
        }
        break;
    }
  }

  // Tracks which code files are "aggressively" collapsed (beyond noise).
  // Map: filepath → summaryLine (the one-liner replacement)
  const aggressiveMap = new Map<string, string>();

  function buildOutput(): string {
    const parts: string[] = [];
    for (const entry of entries) {
      if (entry.isNoise) {
        if (entry.summaryLine !== null) parts.push(entry.summaryLine);
        // sourcemaps have null summaryLine — omitted intentionally
      } else if (aggressiveMap.has(entry.file.filepath)) {
        parts.push(aggressiveMap.get(entry.file.filepath)!);
      } else {
        parts.push(entry.file.content);
      }
    }
    return parts.join("");
  }

  // Phase 2: budget-driven tiers (only applied to non-noise code files)
  const codeEntries = entries.filter((e) => !e.isNoise);

  // Check if we need any aggressive summarization at all
  let output = buildOutput();
  if (output.length <= maxBytes) {
    return {
      processedDiff: output,
      summarized,
      aggressivelySummarized: [],
      tokensSaved,
    };
  }

  // Tier 1: summarize code files > 5 KB
  const TIER1_THRESHOLD = 5 * 1024;
  for (const entry of codeEntries) {
    if (entry.file.content.length > TIER1_THRESHOLD && !aggressiveMap.has(entry.file.filepath)) {
      tokensSaved += estimateTokens(entry.file.content);
      aggressiveMap.set(entry.file.filepath, buildFileSummary(entry.file));
    }
  }

  output = buildOutput();
  if (output.length <= maxBytes) {
    return {
      processedDiff: output,
      summarized,
      aggressivelySummarized: [...aggressiveMap.keys()],
      tokensSaved,
    };
  }

  // Tier 2: summarize code files > 2 KB
  const TIER2_THRESHOLD = 2 * 1024;
  for (const entry of codeEntries) {
    if (entry.file.content.length > TIER2_THRESHOLD && !aggressiveMap.has(entry.file.filepath)) {
      tokensSaved += estimateTokens(entry.file.content);
      aggressiveMap.set(entry.file.filepath, buildFileSummary(entry.file));
    }
  }

  output = buildOutput();
  if (output.length <= maxBytes) {
    return {
      processedDiff: output,
      summarized,
      aggressivelySummarized: [...aggressiveMap.keys()],
      tokensSaved,
    };
  }

  // Final fallback: summarize ALL remaining code files
  for (const entry of codeEntries) {
    if (!aggressiveMap.has(entry.file.filepath)) {
      tokensSaved += estimateTokens(entry.file.content);
      aggressiveMap.set(entry.file.filepath, buildFileSummary(entry.file));
    }
  }

  return {
    processedDiff: buildOutput(),
    summarized,
    aggressivelySummarized: [...aggressiveMap.keys()],
    tokensSaved,
  };
}
