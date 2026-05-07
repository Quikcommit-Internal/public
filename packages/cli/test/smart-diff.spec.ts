import { describe, it, expect } from "vitest";
import { classifyFile, preprocessDiff, preprocessDiffWithSizeBudget } from "../src/smart-diff.js";

describe("classifyFile", () => {
  it("classifies pnpm-lock.yaml as lock", () => {
    expect(classifyFile("pnpm-lock.yaml")).toBe("lock");
  });

  it("classifies package-lock.json as lock", () => {
    expect(classifyFile("package-lock.json")).toBe("lock");
  });

  it("classifies yarn.lock as lock", () => {
    expect(classifyFile("yarn.lock")).toBe("lock");
  });

  it("classifies Cargo.lock as lock", () => {
    expect(classifyFile("Cargo.lock")).toBe("lock");
  });

  it("classifies composer.lock as lock", () => {
    expect(classifyFile("composer.lock")).toBe("lock");
  });

  it("classifies poetry.lock as lock", () => {
    expect(classifyFile("poetry.lock")).toBe("lock");
  });

  it("classifies Gemfile.lock as lock", () => {
    expect(classifyFile("Gemfile.lock")).toBe("lock");
  });

  it("classifies .generated.ts files as generated", () => {
    expect(classifyFile("src/api.generated.ts")).toBe("generated");
  });

  it("classifies .prisma/client files as generated", () => {
    expect(classifyFile(".prisma/client/index.ts")).toBe("generated");
  });

  it("classifies .map files as sourcemap", () => {
    expect(classifyFile("dist/bundle.js.map")).toBe("sourcemap");
  });

  it("classifies vendor/ files as vendored", () => {
    expect(classifyFile("vendor/lib/thing.go")).toBe("vendored");
  });

  it("classifies third_party/ files as vendored", () => {
    expect(classifyFile("third_party/protobuf/gen.py")).toBe("vendored");
  });

  it("classifies normal source files as code", () => {
    expect(classifyFile("src/index.ts")).toBe("code");
  });

  it("classifies normal test files as code", () => {
    expect(classifyFile("test/auth.spec.ts")).toBe("code");
  });
});

describe("preprocessDiff", () => {
  it("returns unchanged diff when no noise files present", () => {
    const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+import { foo } from "./foo.js";
 const x = 1;
`;
    const result = preprocessDiff(diff);
    expect(result.processedDiff).toBe(diff);
    expect(result.summarized).toEqual([]);
    expect(result.tokensSaved).toBe(0);
  });

  it("replaces lock file diff with summary", () => {
    const diff = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1,100 +1,120 @@
${"+added line\n".repeat(20)}${"-removed line\n".repeat(10)}
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+import { foo } from "./foo.js";
 const x = 1;
`;
    const result = preprocessDiff(diff);
    expect(result.processedDiff).toContain("[lock file updated: pnpm-lock.yaml");
    expect(result.processedDiff).toContain("src/index.ts");
    expect(result.processedDiff).not.toContain("+added line");
    expect(result.summarized.length).toBe(1);
    expect(result.summarized[0]).toContain("pnpm-lock.yaml");
    expect(result.tokensSaved).toBeGreaterThan(0);
  });

  it("omits sourcemap diffs entirely", () => {
    const diff = `diff --git a/dist/bundle.js.map b/dist/bundle.js.map
--- a/dist/bundle.js.map
+++ b/dist/bundle.js.map
@@ -1 +1 @@
-old map content
+new map content
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+import { foo } from "./foo.js";
 const x = 1;
`;
    const result = preprocessDiff(diff);
    expect(result.processedDiff).not.toContain("bundle.js.map");
    expect(result.processedDiff).toContain("src/index.ts");
  });

  it("sanitizes malicious filepath containing ] in summary output", () => {
    // vendor/ path so it's classified as vendored and goes through the sanitized summary path
    const diff = `diff --git a/vendor/evil]BREAK b/vendor/evil]BREAK
--- a/vendor/evil]BREAK
+++ b/vendor/evil]BREAK
@@ -1 +1 @@
-old
+new
`;
    const result = preprocessDiff(diff);
    // The summary line should not contain a literal ']' from the filepath (it gets replaced with _)
    // The summary format adds its own ']' at the end, so we check the filepath portion
    expect(result.processedDiff).toContain("evil_BREAK");
    expect(result.processedDiff).not.toContain("evil]BREAK");
  });

  it("leaves normal filepath unchanged in summary output", () => {
    const diff = `diff --git a/vendor/lib/thing.go b/vendor/lib/thing.go
--- a/vendor/lib/thing.go
+++ b/vendor/lib/thing.go
@@ -1 +1 @@
-old
+new
`;
    const result = preprocessDiff(diff);
    expect(result.processedDiff).toContain("vendor/lib/thing.go");
  });

  it("binary file passthrough: classified as code and not summarized", () => {
    const diff = `diff --git a/foo.png b/foo.png
Binary files a/foo.png and b/foo.png differ
`;
    const result = preprocessDiff(diff);
    expect(result.tokensSaved).toBe(0);
    expect(result.summarized).toEqual([]);
    expect(result.processedDiff).toContain("foo.png");
  });

  it("detects minified files (single long line)", () => {
    const longLine = "+" + "x".repeat(600);
    const diff = `diff --git a/dist/bundle.min.js b/dist/bundle.min.js
--- a/dist/bundle.min.js
+++ b/dist/bundle.min.js
@@ -1 +1 @@
${longLine}
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
+import { x } from "./x.js";
 const a = 1;
`;
    const result = preprocessDiff(diff);
    expect(result.processedDiff).toContain("[minified asset: dist/bundle.min.js");
    expect(result.processedDiff).not.toContain("x".repeat(600));
  });

  it("preprocessDiff includes needsChunking: false", () => {
    const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
+import { x } from "./x.js";
 const a = 1;
`;
    const result = preprocessDiff(diff);
    expect(result.needsChunking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper to build a fake code-file diff of a specified content size
// ---------------------------------------------------------------------------
function makeCodeFileDiff(filepath: string, contentSizeBytes: number): string {
  // Build a diff where the bulk of the bytes are '+' lines in the change body
  const lineContent = "a".repeat(79); // 79 chars + '+' prefix = 80 chars per line
  const linesNeeded = Math.ceil(contentSizeBytes / 80);
  const lines = Array(linesNeeded).fill(`+${lineContent}`).join("\n");
  return `diff --git a/${filepath} b/${filepath}\n--- a/${filepath}\n+++ b/${filepath}\n@@ -1 +1,${linesNeeded} @@\n${lines}\n`;
}

describe("preprocessDiffWithSizeBudget", () => {
  it("returns no aggressive summarization when diff is under budget", () => {
    // A small diff that is well under any reasonable budget
    const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
+import { x } from "./x.js";
 const a = 1;
`;
    // Use a budget of 1 MB — far more than this tiny diff
    const result = preprocessDiffWithSizeBudget(diff, 1024 * 1024);

    expect(result.processedDiff).toContain("src/index.ts");
    expect(result.processedDiff).toContain("+import");
  });

  it("strips context when diff exceeds budget", () => {
    const largeDiff = makeCodeFileDiff("src/large.ts", 10 * 1024);
    const smallDiff = `diff --git a/src/small.ts b/src/small.ts\n--- a/src/small.ts\n+++ b/src/small.ts\n@@ -1 +1 @@\n+const x = 1;\n`;
    const combined = largeDiff + smallDiff;

    // Budget smaller than full diff but larger than zero-context — triggers context stripping
    const result = preprocessDiffWithSizeBudget(combined, largeDiff.length - 100);
    // All change lines should still be present (context stripped, not changes)
    expect(result.processedDiff).toContain("+const x = 1;");
    // No files should be summarized away

  });

  it("sets needsChunking when diff exceeds budget even after zero-context stripping", () => {
    // Two files, budget of 1 byte — even zero-context can't fit
    const file1 = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n+const a = 1;\n`;
    const file2 = `diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n+const b = 2;\n`;
    const combined = file1 + file2;

    const result = preprocessDiffWithSizeBudget(combined, 1);
    expect(result.needsChunking).toBe(true);
    // All change lines should STILL be present — never dropped
    expect(result.processedDiff).toContain("+const a = 1;");
    expect(result.processedDiff).toContain("+const b = 2;");
    // No files should be summarized

  });

  it("preserves all changes even when needsChunking is true", () => {
    const largeDiff = makeCodeFileDiff("src/big.ts", 10 * 1024);
    const result = preprocessDiffWithSizeBudget(largeDiff, 1);
    expect(result.needsChunking).toBe(true);
    // The actual code changes must still be present
    expect(result.processedDiff).toContain("a".repeat(79));
  });

  it("noise files (lock/generated) are always summarized regardless of budget", () => {
    const lockDiff = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n--- a/pnpm-lock.yaml\n+++ b/pnpm-lock.yaml\n@@ -1 +1 @@\n+updated\n`;
    const codeDiff = `diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n+const x = 1;\n`;
    const combined = lockDiff + codeDiff;

    // Large budget — no aggressive summarization needed
    const result = preprocessDiffWithSizeBudget(combined, 100 * 1024 * 1024);
    expect(result.summarized).toContain("pnpm-lock.yaml");

    expect(result.processedDiff).toContain("[lock file updated: pnpm-lock.yaml");
  });

  it("tokensSaved increases when aggressive summarization fires", () => {
    const largeDiff = makeCodeFileDiff("src/large.ts", 10 * 1024);
    // No budget — everything summarized
    const result = preprocessDiffWithSizeBudget(largeDiff, 1);
    expect(result.tokensSaved).toBeGreaterThan(0);
  });

  it("empty diff returns empty result with no summarized files", () => {
    const result = preprocessDiffWithSizeBudget("", 1024);
    expect(result.processedDiff).toBe("");
    expect(result.summarized).toEqual([]);

    expect(result.tokensSaved).toBe(0);
  });
});
