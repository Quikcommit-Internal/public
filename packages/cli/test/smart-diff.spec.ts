import { describe, it, expect } from "vitest";
import { classifyFile, preprocessDiff } from "../src/smart-diff.js";

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
});
