/**
 * ui-layout.ts — layout and rendering helpers extracted from ui-rich.ts.
 *
 * Contains:
 *   - stripAnsi
 *   - EXTENSION_COLORS, colorizePath
 *   - renderFileTree, FileTreeOpts
 *   - renderStatsLine, StatsInput
 *   - BOX_CHARS, BoxStyle, BoxOpts, boxedLine, wrapLine,
 *     renderBoxedCommit, splitCommitForBox, ParsedHeader, isImportantCommit
 *   - MIN_BOX_WIDTH, PADDING
 *   - shouldUseRichOutput, RichDecisionOpts
 */

import pc from "picocolors";
import type { Theme } from "./ui-theme.js";

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex -- intentional ESC (U+001B) prefix in CSI pattern
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// Conventional-commit header parsing
// ---------------------------------------------------------------------------

const HEADER_RX = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.*)$/;

export interface ParsedHeader {
  type: string | null;
  scope: string | null;
  subject: string;
  breaking: boolean;
}

export function splitCommitForBox(message: string): ParsedHeader {
  const firstLine = message.split("\n")[0] ?? "";
  const m = firstLine.match(HEADER_RX);
  if (!m) return { type: null, scope: null, subject: firstLine, breaking: false };
  return {
    type: m[1] ?? null,
    scope: m[2] ?? null,
    breaking: m[3] === "!",
    subject: m[4] ?? "",
  };
}

// ---------------------------------------------------------------------------
// File-path colorizer
// ---------------------------------------------------------------------------

const EXTENSION_COLORS: Record<string, (s: string) => string> = {
  ".ts": pc.cyan,
  ".mts": pc.cyan,
  ".tsx": pc.cyanBright,
  ".js": pc.yellow,
  ".mjs": pc.yellow,
  ".cjs": pc.yellow,
  ".jsx": pc.yellowBright,
  ".py": pc.blue,
  ".rs": pc.red,
  ".go": pc.cyanBright,
  ".css": pc.magenta,
  ".scss": pc.magenta,
  ".sass": pc.magenta,
  ".html": pc.redBright,
  ".md": pc.green,
  ".json": (s) => pc.dim(pc.cyan(s)),
  ".yaml": (s) => pc.dim(pc.cyan(s)),
  ".yml": (s) => pc.dim(pc.cyan(s)),
  ".toml": (s) => pc.dim(pc.cyan(s)),
  ".lock": pc.dim,
};

function colorizePath(filepath: string, isColor: boolean): string {
  if (!isColor) return filepath;
  const slashIdx = filepath.lastIndexOf("/");
  const dir = slashIdx >= 0 ? filepath.slice(0, slashIdx + 1) : "";
  const name = slashIdx >= 0 ? filepath.slice(slashIdx + 1) : filepath;
  const dotIdx = name.lastIndexOf(".");
  // dotIdx > 0 intentionally excludes dot-files like ".gitignore" (no extension).
  const ext = dotIdx > 0 ? name.slice(dotIdx) : "";
  const colorize = EXTENSION_COLORS[ext];
  const coloredName = colorize ? colorize(name) : name;
  return (dir ? pc.dim(dir) : "") + coloredName;
}

// ---------------------------------------------------------------------------
// File tree renderer
// ---------------------------------------------------------------------------

export interface FileTreeOpts {
  isColor?: boolean;
}

export function renderFileTree(files: string[], maxFiles: number, opts: FileTreeOpts = {}): string {
  if (files.length === 0) return "";
  const isColor = opts.isColor ?? false;
  const lines: string[] = [];
  const display = files.slice(0, maxFiles);
  const overflow = files.length - maxFiles;

  for (let i = 0; i < display.length; i++) {
    const isLast = i === display.length - 1 && overflow <= 0;
    const connector = isLast ? "└─" : "├─";
    const colored = colorizePath(display[i] ?? "", isColor);
    const connectorRendered = isColor ? pc.dim(connector) : connector;
    lines.push(`    ${connectorRendered} ${colored}`);
  }

  if (overflow > 0) {
    const connector = isColor ? pc.dim("└─") : "└─";
    const more = isColor ? pc.dim(`+${overflow} more files`) : `+${overflow} more files`;
    lines.push(`    ${connector} ${more}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stats line
// ---------------------------------------------------------------------------

export interface StatsInput {
  files: number;
  additions: number;
  deletions: number;
  tokens?: number;
}

export function renderStatsLine(stats: StatsInput, isColor: boolean, theme?: Theme): string {
  if (stats.files === 0 && stats.additions === 0 && stats.deletions === 0) return "";
  const dim = theme?.dim ?? pc.dim;
  const addFn = theme?.additions ?? ((s: string) => pc.green(s));
  const delFn = theme?.deletions ?? ((s: string) => pc.red(s));
  const filesText = isColor ? dim(`${stats.files} files`) : `${stats.files} files`;
  const additions = isColor ? addFn(`+${stats.additions}`) : `+${stats.additions}`;
  const deletions = isColor ? delFn(`−${stats.deletions}`) : `−${stats.deletions}`;
  const sep = isColor ? dim(" · ") : " · ";
  let text = `${filesText}${sep}${additions} ${deletions}`;
  if (stats.tokens !== undefined) {
    const tokens = isColor ? dim(`${stats.tokens} tokens`) : `${stats.tokens} tokens`;
    text += `${sep}${tokens}`;
  }
  return `    ${text}`;
}

// ---------------------------------------------------------------------------
// Box rendering
// ---------------------------------------------------------------------------

export type BoxStyle = "rounded" | "gradient" | "double" | "none";

export interface BoxOpts {
  width: number;
  isColor: boolean;
  style?: BoxStyle;
  autoEmphasis?: boolean;
  /** When set with isColor, header lines and box borders use this palette (cap corners use {@link Theme.boxBorderAccent}) */
  theme?: Theme;
}

export const MIN_BOX_WIDTH = 60;
export const PADDING = 2;

export function wrapLine(text: string, width: number): string[] {
  if (stripAnsi(text).length <= width) return [text];
  const result: string[] = [];
  let remaining = text;
  while (stripAnsi(remaining).length > width) {
    // Walk raw string tracking visible character count; record last space position.
    let visibleCount = 0;
    let rawIdx = 0;
    let lastSpaceRaw = -1;
    const len = remaining.length;
    while (rawIdx < len && visibleCount < width) {
      if (remaining[rawIdx] === "\x1b") {
        // Skip ANSI escape sequence (ends at 'm')
        while (rawIdx < len && remaining[rawIdx] !== "m") rawIdx++;
        if (rawIdx < len) rawIdx++; // skip the 'm' (guard against missing terminator)
        continue;
      }
      if (remaining[rawIdx] === " ") lastSpaceRaw = rawIdx;
      visibleCount++;
      rawIdx++;
    }
    const breakAt = lastSpaceRaw > 0 && lastSpaceRaw > width / 2 ? lastSpaceRaw : rawIdx;
    result.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining) result.push(remaining);
  return result;
}

function isImportantCommit(header: string, body: string): boolean {
  if (/BREAKING CHANGE/i.test(body)) return true;
  if (/^[a-z]+(\([^)]+\))?!:/i.test(header)) return true;
  return false;
}

interface BoxChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
}

const BOX_CHARS: Record<Exclude<BoxStyle, "none">, BoxChars> = {
  rounded: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
  },
  gradient: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
  },
  double: {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
  },
};

/** Top / bottom rule: accent corners via `boxBorderAccent`, horizontal run via `boxBorder`. */
function styleBoxTopRow(box: BoxChars, horizRepeat: number, isColor: boolean, theme?: Theme): string {
  if (!isColor) return box.topLeft + box.horizontal.repeat(horizRepeat) + box.topRight;
  const edge = theme?.boxBorder ?? pc.dim;
  const corner = theme?.boxBorderAccent ?? edge;
  return corner(box.topLeft) + edge(box.horizontal.repeat(horizRepeat)) + corner(box.topRight);
}

function styleBoxBottomRow(box: BoxChars, horizRepeat: number, isColor: boolean, theme?: Theme): string {
  if (!isColor) return box.bottomLeft + box.horizontal.repeat(horizRepeat) + box.bottomRight;
  const edge = theme?.boxBorder ?? pc.dim;
  const corner = theme?.boxBorderAccent ?? edge;
  return corner(box.bottomLeft) + edge(box.horizontal.repeat(horizRepeat)) + corner(box.bottomRight);
}

export function boxedLine(
  vertical: string,
  content: string,
  innerWidth: number,
  isColor: boolean,
  theme?: Theme
): string {
  const visibleLen = stripAnsi(content).length;
  const padding = " ".repeat(Math.max(0, innerWidth - visibleLen));
  const border = isColor ? (theme?.boxBorder ?? pc.dim)(vertical) : vertical;
  return `  ${border}  ${content}${padding}  ${border}`;
}

function buildHeaderPrefixAndSubject(
  parsed: ParsedHeader,
  headerFirstLine: string,
  isColor: boolean,
  theme?: Theme
): { prefix: string; subjectText: string } {
  if (!parsed.type) {
    return { prefix: "", subjectText: headerFirstLine };
  }
  const bangPlain = parsed.breaking ? "!" : "";
  if (parsed.scope) {
    const prefixPlain = `${parsed.type}(${parsed.scope})${bangPlain}: `;
    if (!isColor) {
      return { prefix: prefixPlain, subjectText: parsed.subject };
    }
    const typeCell = theme
      ? (theme.type[parsed.type] ?? theme.type.feat ?? ((s: string) => s))
      : (s: string) => pc.bold(pc.cyan(s));
    const scopeCell = theme ? theme.scope : (s: string) => pc.bold(pc.yellow(s));
    const bangCell = theme
      ? parsed.breaking
        ? theme.error("!")
        : ""
      : parsed.breaking
        ? pc.bold(pc.red("!"))
        : "";
    const prefixStyled = `${typeCell(parsed.type)}(${scopeCell(parsed.scope)})${bangCell}: `;
    return { prefix: prefixStyled, subjectText: parsed.subject };
  }
  const prefixPlain = `${parsed.type}${bangPlain}: `;
  if (!isColor) {
    return { prefix: prefixPlain, subjectText: parsed.subject };
  }
  const typeCell = theme
    ? (theme.type[parsed.type] ?? theme.type.feat ?? ((s: string) => s))
    : (s: string) => pc.bold(pc.cyan(s));
  const bangCell = theme
    ? parsed.breaking
      ? theme.error("!")
      : ""
    : parsed.breaking
      ? pc.bold(pc.red("!"))
      : "";
  const prefixStyled = `${typeCell(parsed.type)}${bangCell}: `;
  return { prefix: prefixStyled, subjectText: parsed.subject };
}

export function renderBoxedCommit(header: string, body: string, opts: BoxOpts): string {
  const requestedStyle = opts.style ?? "gradient";
  const promoted =
    opts.autoEmphasis !== false &&
    requestedStyle !== "none" &&
    isImportantCommit(header.split("\n")[0] ?? header, body);
  const style: BoxStyle = promoted ? "double" : requestedStyle;

  if (style === "none" || opts.width < MIN_BOX_WIDTH) {
    const lines = [header.split("\n")[0] ?? header];
    if (body) lines.push("", body);
    return lines.join("\n");
  }

  const chars = BOX_CHARS[style];
  const innerWidth = opts.width - 6;
  const horiz = opts.width - 2;
  const firstLineHeader = header.split("\n")[0] ?? header;
  const parsed = splitCommitForBox(header);
  const { prefix: headerPrefix, subjectText } = buildHeaderPrefixAndSubject(
    parsed,
    firstLineHeader,
    opts.isColor,
    opts.theme
  );

  const prefixLen = stripAnsi(headerPrefix).length;
  const subjectLines = wrapLine(subjectText, Math.max(1, innerWidth - prefixLen));

  const styledTop = styleBoxTopRow(chars, horiz, opts.isColor, opts.theme);
  const styledBottom = styleBoxBottomRow(chars, horiz, opts.isColor, opts.theme);

  const lines: string[] = [];
  lines.push("  " + styledTop);
  lines.push(boxedLine(chars.vertical, headerPrefix + (subjectLines[0] ?? ""), innerWidth, opts.isColor, opts.theme));
  for (let i = 1; i < subjectLines.length; i++) {
    lines.push(boxedLine(chars.vertical, "  " + (subjectLines[i] ?? ""), innerWidth, opts.isColor, opts.theme));
  }

  if (body) {
    lines.push(boxedLine(chars.vertical, "", innerWidth, opts.isColor, opts.theme));
    for (const bline of body.split("\n")) {
      const trimmed = bline.trim();
      if (!trimmed) continue;
      const bulletChar = opts.isColor ? (opts.theme?.bullet ?? pc.green)("•") : "•";
      const rendered = trimmed.replace(/^[-*]\s+/, `${bulletChar} `);
      const wrapped = wrapLine(rendered, innerWidth);
      for (let i = 0; i < wrapped.length; i++) {
        lines.push(
          boxedLine(chars.vertical, (i === 0 ? "" : "  ") + (wrapped[i] ?? ""), innerWidth, opts.isColor, opts.theme)
        );
      }
    }
  }

  lines.push("  " + styledBottom);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Rich output decision
// ---------------------------------------------------------------------------

export interface RichDecisionOpts {
  isTTY: boolean;
  noColor: boolean;
  width: number;
  style: "rich" | "compact" | "minimal";
}

export function shouldUseRichOutput(opts: RichDecisionOpts): boolean {
  if (!opts.isTTY) return false;
  if (opts.noColor) return false;
  if (opts.style !== "rich") return false;
  if (opts.width < MIN_BOX_WIDTH) return false;
  return true;
}
