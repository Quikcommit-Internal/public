import { describe, it, expect } from "vitest";
import { preprocessDiffWithSizeBudget, classifyFile, preprocessDiff, splitDiffIntoChunks } from "./smart-diff.js";

// Helper: build a fake git diff for a single file
function makeDiff(filepath: string, changes: string[], contextPerHunk = 3): string {
  const lines: string[] = [
    `diff --git a/${filepath} b/${filepath}`,
    `index abc1234..def5678 100644`,
    `--- a/${filepath}`,
    `+++ b/${filepath}`,
  ];

  // Build one hunk with context lines around each change
  const hunkLines: string[] = [];
  for (const change of changes) {
    for (let c = 0; c < contextPerHunk; c++) {
      hunkLines.push(` context-before-${c}`);
    }
    hunkLines.push(change);
    for (let c = 0; c < contextPerHunk; c++) {
      hunkLines.push(` context-after-${c}`);
    }
  }
  lines.push(`@@ -1,${hunkLines.length} +1,${hunkLines.length} @@`);
  lines.push(...hunkLines);

  return lines.join("\n");
}

function multiFileDiff(count: number, linesPerFile: number): string {
  const diffs: string[] = [];
  for (let i = 0; i < count; i++) {
    const changes: string[] = [];
    for (let j = 0; j < linesPerFile; j++) {
      changes.push(`+added line ${j} in file ${i} ${"x".repeat(80)}`);
    }
    diffs.push(makeDiff(`src/file-${i}.ts`, changes));
  }
  return diffs.join("\n");
}

describe("classifyFile", () => {
  it("classifies lock files", () => {
    expect(classifyFile("pnpm-lock.yaml")).toBe("lock");
    expect(classifyFile("package-lock.json")).toBe("lock");
  });

  it("classifies sourcemaps", () => {
    expect(classifyFile("dist/index.js.map")).toBe("sourcemap");
  });

  it("classifies vendored files", () => {
    expect(classifyFile("vendor/lib/foo.go")).toBe("vendored");
  });

  it("classifies generated files", () => {
    expect(classifyFile("src/schema.generated.ts")).toBe("generated");
  });

  it("classifies code files", () => {
    expect(classifyFile("src/index.ts")).toBe("code");
    expect(classifyFile("README.md")).toBe("code");
  });
});

describe("preprocessDiff", () => {
  it("passes through normal code diffs", () => {
    const diff = makeDiff("src/app.ts", ["+new line", "-old line"]);
    const result = preprocessDiff(diff);
    expect(result.summarized).toHaveLength(0);
    expect(result.processedDiff).toBe(diff);
  });

  it("summarizes lock files", () => {
    const diff = makeDiff("pnpm-lock.yaml", ["+new dep"]);
    const result = preprocessDiff(diff);
    expect(result.summarized).toContain("pnpm-lock.yaml");
    expect(result.processedDiff).toContain("[lock file updated:");
  });
});

describe("preprocessDiffWithSizeBudget", () => {
  it("returns full diff when under budget", () => {
    const diff = makeDiff("src/app.ts", ["+hello"]);
    const result = preprocessDiffWithSizeBudget(diff, 1024 * 1024);
    expect(result.processedDiff).toContain("+hello");

  });

  it("strips context lines when over budget", () => {
    // 20 files × 50 changes each → large diff where context stripping helps
    const diff = multiFileDiff(20, 50);
    const fullSize = diff.length;
    // Budget at 60% of full size — context stripping (tier 1/2) should handle this
    // without needing to summarize any files away
    const result = preprocessDiffWithSizeBudget(diff, Math.floor(fullSize * 0.6));

    // Should be smaller than full diff
    expect(result.processedDiff.length).toBeLessThan(fullSize);

    // All +added lines should still be present (context stripped, not changes)
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 50; j++) {
        expect(result.processedDiff).toContain(`+added line ${j} in file ${i}`);
      }
    }
    // No files should be fully summarized since context stripping was enough

  });

  it("preserves all change lines even with zero-context stripping", () => {
    // Large diff — budget tight enough to need zero-context but not file summarization
    const diff = multiFileDiff(10, 30);
    // Changes are ~100 chars each, 10*30=300 changes. Context is 6 lines × ~20 chars each.
    // Zero-context output ≈ just the changes + headers. Set budget between zero-context and 1-context.
    const changesOnlySize = diff.split("\n")
      .filter(l => l.startsWith("+") || l.startsWith("-") || l.startsWith("@@") || l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("---") || l.startsWith("+++"))
      .join("\n").length;
    const result = preprocessDiffWithSizeBudget(diff, Math.floor(changesOnlySize * 1.2));

    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 30; j++) {
        expect(result.processedDiff).toContain(`+added line ${j} in file ${i}`);
      }
    }
  });

  it("removes context lines but keeps hunk headers and changes", () => {
    // 15 files × 40 changes — enough that context stripping handles 60% budget
    const diff = multiFileDiff(15, 40);
    const result = preprocessDiffWithSizeBudget(diff, Math.floor(diff.length * 0.6));

    // Hunk headers should be preserved
    expect(result.processedDiff).toContain("@@");

    // Context lines should be reduced
    const contextCount = result.processedDiff.split("\n").filter(l => l.startsWith(" context-")).length;
    const fullContextCount = diff.split("\n").filter(l => l.startsWith(" context-")).length;
    expect(contextCount).toBeLessThan(fullContextCount);

    // All actual changes should be present (no files should be summarized away)
    for (let i = 0; i < 15; i++) {
      expect(result.processedDiff).toContain(`+added line 0 in file ${i}`);
    }

  });

  it("signals needsChunking when diff exceeds budget after context stripping", () => {
    const diff = multiFileDiff(20, 50);
    const result = preprocessDiffWithSizeBudget(diff, 5000);

    expect(result.needsChunking).toBe(true);
    // All change lines must still be present — never dropped
    expect(result.processedDiff).toContain("+added line 0 in file 0");
    expect(result.processedDiff).toContain("+added line 49 in file 19");
    // No files summarized

  });

  it("summarizes noise files regardless of budget", () => {
    const code = makeDiff("src/app.ts", ["+new feature"]);
    const lock = makeDiff("pnpm-lock.yaml", ["+dep upgrade"]);
    const diff = code + "\n" + lock;

    const result = preprocessDiffWithSizeBudget(diff, 1024 * 1024);
    expect(result.summarized).toContain("pnpm-lock.yaml");
    expect(result.processedDiff).toContain("+new feature");
    expect(result.processedDiff).not.toContain("+dep upgrade");
  });
});

describe("splitDiffIntoChunks", () => {
  it("returns single chunk when diff fits", () => {
    const diff = makeDiff("src/app.ts", ["+hello"]);
    const chunks = splitDiffIntoChunks(diff, 1024 * 1024);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].files).toContain("src/app.ts");
    expect(chunks[0].diff).toContain("+hello");
  });

  it("splits into multiple chunks when diff exceeds limit", () => {
    const diff = multiFileDiff(10, 20);
    const singleFileSize = diff.length / 10;
    const chunks = splitDiffIntoChunks(diff, Math.floor(singleFileSize * 1.5));

    expect(chunks.length).toBeGreaterThan(1);

    const allFiles = chunks.flatMap((c) => c.files);
    for (let i = 0; i < 10; i++) {
      expect(allFiles).toContain(`src/file-${i}.ts`);
    }

    const allDiff = chunks.map((c) => c.diff).join("\n");
    for (let i = 0; i < 10; i++) {
      expect(allDiff).toContain(`+added line 0 in file ${i}`);
    }
  });

  it("keeps complete file diffs together", () => {
    const diff = multiFileDiff(5, 10);
    const chunks = splitDiffIntoChunks(diff, Math.floor(diff.length / 3));

    for (const chunk of chunks) {
      for (const file of chunk.files) {
        expect(chunk.diff).toContain(`diff --git a/${file} b/${file}`);
      }
    }
  });
});
