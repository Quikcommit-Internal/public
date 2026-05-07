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
  /** When true, the diff exceeds the budget even after context stripping.
   *  The caller should use chunked summarization instead of sending directly. */
  needsChunking: boolean;
}

export interface DiffChunk {
  diff: string;
  files: string[];
}

export function preprocessDiff(diff: string): SmartDiffResult {
  const files = parseDiffIntoFiles(diff);
  if (files.length === 0) return { processedDiff: diff, summarized: [], tokensSaved: 0, needsChunking: false };

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
    needsChunking: false,
  };
}

/**
 * Strip context lines from a file diff, keeping all changed lines (+/-),
 * hunk headers (@@), and file headers (diff/index/---/+++).
 *
 * @param contextLines Number of context lines to keep around each change (0 = none)
 */
function stripContext(fileContent: string, contextLines: number): string {
  const lines = fileContent.split("\n");
  const result: string[] = [];

  // File-level headers: everything before the first @@ hunk
  let inHeader = true;
  // Track which context lines to keep via a sliding window
  const pendingContext: string[] = [];
  let afterChange = 0;

  for (const line of lines) {
    if (inHeader) {
      result.push(line);
      if (line.startsWith("@@")) inHeader = false;
      continue;
    }

    if (line.startsWith("@@")) {
      // New hunk header — flush pending context, reset state
      pendingContext.length = 0;
      afterChange = 0;
      result.push(line);
      continue;
    }

    if (line.startsWith("+") || line.startsWith("-")) {
      if (contextLines > 0) {
        result.push(...pendingContext.slice(-contextLines));
      }
      pendingContext.length = 0;
      result.push(line);
      afterChange = contextLines;
      continue;
    }

    // Context line (starts with space or is empty)
    if (afterChange > 0) {
      result.push(line);
      afterChange--;
    } else {
      pendingContext.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Noise-filter + context-strip diff reduction. Never drops actual code changes.
 *
 * After noise removal, if over budget:
 *   1. Strip context to 1 line per hunk
 *   2. Strip context to 0 lines — just changes + headers
 *   3. If STILL over budget → set needsChunking=true (caller must chunk & summarize)
 *
 * @param diff     Raw git diff string
 * @param maxBytes Budget in bytes (default 750 KB — fits in 256K token context)
 */
export function preprocessDiffWithSizeBudget(
  diff: string,
  maxBytes = 750 * 1024
): SmartDiffResult {
  const files = parseDiffIntoFiles(diff);
  if (files.length === 0) {
    return { processedDiff: diff, summarized: [], tokensSaved: 0, needsChunking: false };
  }

  type FileEntry = {
    file: FileDiff;
    isNoise: boolean;
    summaryLine: string | null;
    strippedContent: string | null;
  };
  const entries: FileEntry[] = [];
  const summarized: string[] = [];
  let tokensSaved = 0;

  for (const file of files) {
    const classification = classifyFile(file.filepath);
    switch (classification) {
      case "sourcemap":
        tokensSaved += estimateTokens(file.content);
        summarized.push(file.filepath);
        entries.push({ file, isNoise: true, summaryLine: null, strippedContent: null });
        break;
      case "lock":
        tokensSaved += estimateTokens(file.content);
        summarized.push(file.filepath);
        entries.push({
          file, isNoise: true, strippedContent: null,
          summaryLine: `[lock file updated: ${sanitizeFilepath(file.filepath)} (+${file.additions} −${file.deletions} lines)]\n`,
        });
        break;
      case "generated":
        tokensSaved += estimateTokens(file.content);
        summarized.push(file.filepath);
        entries.push({
          file, isNoise: true, strippedContent: null,
          summaryLine: `[generated: ${sanitizeFilepath(file.filepath)} (+${file.additions} −${file.deletions})]\n`,
        });
        break;
      case "vendored":
        tokensSaved += estimateTokens(file.content);
        summarized.push(file.filepath);
        entries.push({
          file, isNoise: true, strippedContent: null,
          summaryLine: `[vendored: ${sanitizeFilepath(file.filepath)} updated]\n`,
        });
        break;
      case "code":
        if (isMinified(file.content)) {
          tokensSaved += estimateTokens(file.content);
          const sizeKB = Math.round(file.content.length / 1024);
          summarized.push(file.filepath);
          entries.push({
            file, isNoise: true, strippedContent: null,
            summaryLine: `[minified asset: ${sanitizeFilepath(file.filepath)} (${sizeKB} KB)]\n`,
          });
        } else {
          entries.push({ file, isNoise: false, summaryLine: null, strippedContent: null });
        }
        break;
    }
  }

  const codeEntries = entries.filter((e) => !e.isNoise);

  function buildOutput(): string {
    const parts: string[] = [];
    for (const entry of entries) {
      if (entry.isNoise) {
        if (entry.summaryLine !== null) parts.push(entry.summaryLine);
      } else {
        parts.push(entry.strippedContent ?? entry.file.content);
      }
    }
    return parts.join("");
  }

  let output = buildOutput();
  if (output.length <= maxBytes) {
    return { processedDiff: output, summarized, tokensSaved, needsChunking: false };
  }

  // Tier 1: strip context to 1 line
  for (const entry of codeEntries) {
    const stripped = stripContext(entry.file.content, 1);
    tokensSaved += estimateTokens(entry.file.content) - estimateTokens(stripped);
    entry.strippedContent = stripped;
  }

  output = buildOutput();
  if (output.length <= maxBytes) {
    return { processedDiff: output, summarized, tokensSaved, needsChunking: false };
  }

  // Tier 2: strip context to 0 lines
  for (const entry of codeEntries) {
    const stripped = stripContext(entry.file.content, 0);
    tokensSaved += estimateTokens(entry.strippedContent ?? entry.file.content) - estimateTokens(stripped);
    entry.strippedContent = stripped;
  }

  output = buildOutput();
  if (output.length <= maxBytes) {
    return { processedDiff: output, summarized, tokensSaved, needsChunking: false };
  }

  // Still over budget — signal that the caller should chunk + summarize.
  // Return zero-context diff as the processedDiff (best single-call attempt).
  return { processedDiff: output, summarized, tokensSaved, needsChunking: true };
}

/**
 * Split a noise-filtered diff into chunks that each fit within `maxChunkBytes`.
 * Each chunk contains one or more complete file diffs.
 * Files that individually exceed the limit get their own chunk (with zero-context stripping).
 */
export function splitDiffIntoChunks(diff: string, maxChunkBytes = 600 * 1024): DiffChunk[] {
  const files = parseDiffIntoFiles(diff);
  if (files.length === 0) return [];

  const chunks: DiffChunk[] = [];
  let currentDiff = "";
  let currentFiles: string[] = [];

  for (const file of files) {
    let content = file.content;

    // If a single file exceeds the chunk limit, strip its context
    if (content.length > maxChunkBytes) {
      content = stripContext(content, 0);
    }

    // If adding this file would exceed the limit, flush the current chunk
    if (currentDiff.length > 0 && currentDiff.length + content.length > maxChunkBytes) {
      chunks.push({ diff: currentDiff, files: currentFiles });
      currentDiff = "";
      currentFiles = [];
    }

    currentDiff += content;
    currentFiles.push(file.filepath);
  }

  if (currentDiff.length > 0) {
    chunks.push({ diff: currentDiff, files: currentFiles });
  }

  return chunks;
}
