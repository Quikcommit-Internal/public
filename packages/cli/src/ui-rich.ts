import pc from "picocolors";
import { getTerminalWidth as getTermWidth } from "./ui.js";

export { getTermWidth as getTerminalWidth };

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

export function renderFileTree(files: string[], maxFiles: number): string {
  if (files.length === 0) return "";
  const lines: string[] = [];
  const display = files.slice(0, maxFiles);
  const overflow = Math.max(0, files.length - maxFiles);

  for (let i = 0; i < display.length; i++) {
    const isLast = i === display.length - 1 && overflow === 0;
    const connector = isLast ? "└─" : "├─";
    lines.push(`    ${connector} ${display[i]}`);
  }

  if (overflow > 0) {
    lines.push(`    └─ +${overflow} more files`);
  }

  return lines.join("\n");
}

export interface BoxOpts {
  width: number;
  isColor: boolean;
}

const MIN_BOX_WIDTH = 60;

function wrapLine(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const result: string[] = [];
  let remaining = text;
  while (remaining.length > width) {
    let breakAt = remaining.lastIndexOf(" ", width);
    if (breakAt < width / 2) breakAt = width;
    result.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining) result.push(remaining);
  return result;
}

export function stripAnsi(s: string): string {
  // Strip ANSI SGR sequences for visible-length padding in boxes.
  // Covers picocolors output: bold (\x1b[1m/\x1b[22m), colors (\x1b[3Xm/\x1b[3Xm), resets (\x1b[39m).
  // eslint-disable-next-line no-control-regex -- intentional ESC (U+001B) prefix in CSI pattern
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function boxedLine(content: string, innerWidth: number, isColor: boolean): string {
  const visibleLen = stripAnsi(content).length;
  const padding = " ".repeat(Math.max(0, innerWidth - visibleLen));
  const border = isColor ? pc.dim("│") : "│";
  return `  ${border}  ${content}${padding}  ${border}`;
}

export function renderBoxedCommit(header: string, body: string, opts: BoxOpts): string {
  if (opts.width < MIN_BOX_WIDTH) {
    const lines = [header.split("\n")[0] ?? header];
    if (body) lines.push("", body);
    return lines.join("\n");
  }

  // Layout math:
  //   top border = "  ╭" + "─".repeat(opts.width - 2) + "╮"  → visible length = opts.width + 2
  //   inner line = "  │  " + content + padding + "  │"
  //                = 2 + 1 + 2 + innerWidth + 2 + 1 = innerWidth + 8
  // For alignment: innerWidth + 8 = opts.width + 2  → innerWidth = opts.width - 6
  const innerWidth = opts.width - 6;
  const horiz = opts.width - 2;
  const top =
    "  " +
    (opts.isColor ? pc.dim("╭" + "─".repeat(horiz) + "╮") : "╭" + "─".repeat(horiz) + "╮");
  const bottom =
    "  " +
    (opts.isColor ? pc.dim("╰" + "─".repeat(horiz) + "╯") : "╰" + "─".repeat(horiz) + "╯");

  const parsed = splitCommitForBox(header);
  let firstLineStyled: string;
  if (parsed.type && parsed.scope) {
    const bare = `${parsed.type}(${parsed.scope})${parsed.breaking ? "!" : ""}: ${parsed.subject}`;
    firstLineStyled = opts.isColor
      ? `${pc.bold(pc.cyan(parsed.type))}(${pc.bold(pc.yellow(parsed.scope))})${parsed.breaking ? pc.bold(pc.red("!")) : ""}: ${parsed.subject}`
      : bare;
  } else if (parsed.type) {
    const bare = `${parsed.type}${parsed.breaking ? "!" : ""}: ${parsed.subject}`;
    firstLineStyled = opts.isColor
      ? `${pc.bold(pc.cyan(parsed.type))}${parsed.breaking ? pc.bold(pc.red("!")) : ""}: ${parsed.subject}`
      : bare;
  } else {
    firstLineStyled = header.split("\n")[0] ?? header;
  }

  const lines: string[] = [];
  const headerParts = wrapLine(firstLineStyled, innerWidth);
  for (let i = 0; i < headerParts.length; i++) {
    const indent = i === 0 ? "" : "  ";
    lines.push(boxedLine(indent + (headerParts[i] ?? ""), innerWidth, opts.isColor));
  }

  if (body) {
    lines.push(boxedLine("", innerWidth, opts.isColor));
    for (const bline of body.split("\n")) {
      const trimmed = bline.trim();
      if (!trimmed) continue;
      const rendered = trimmed.replace(/^[-*]\s+/, opts.isColor ? `${pc.green("•")} ` : "• ");
      const wrapped = wrapLine(rendered, innerWidth);
      for (let i = 0; i < wrapped.length; i++) {
        lines.push(boxedLine((i === 0 ? "" : "  ") + (wrapped[i] ?? ""), innerWidth, opts.isColor));
      }
    }
  }

  return [top, ...lines, bottom].join("\n");
}

export interface StatsInput {
  files: number;
  additions: number;
  deletions: number;
  tokens?: number;
}

export function renderStatsLine(stats: StatsInput, isColor: boolean): string {
  const parts: string[] = [];
  parts.push(`${stats.files} files`);
  parts.push(`+${stats.additions} \u2212${stats.deletions}`);
  if (stats.tokens !== undefined) parts.push(`${stats.tokens} tokens`);
  const text = parts.join(" · ");
  return isColor ? `    ${pc.dim(text)}` : `    ${text}`;
}

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
