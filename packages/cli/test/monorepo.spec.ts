import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  detectWorkspace,
  getPackageForFile,
  autoDetectScope,
} from "../src/monorepo";

describe("monorepo detection", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "qc-monorepo-"));
  });

  afterEach(() => {
    // Cleanup is best-effort on temp dirs
  });

  it("detects pnpm-workspace.yaml and parses packages globs", () => {
    writeFileSync(
      join(cwd, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n  - 'apps/*'\n"
    );
    const ws = detectWorkspace(cwd);
    expect(ws).not.toBeNull();
    expect(ws?.type).toBe("pnpm");
    expect(ws?.packages).toContain("packages/*");
    expect(ws?.packages).toContain("apps/*");
    expect(ws?.root).toBe(cwd);
  });

  it("detects lerna.json and parses packages", () => {
    writeFileSync(
      join(cwd, "lerna.json"),
      JSON.stringify({ packages: ["packages/*", "libs/*"] })
    );
    const ws = detectWorkspace(cwd);
    expect(ws).not.toBeNull();
    expect(ws?.type).toBe("lerna");
    expect(ws?.packages).toContain("packages/*");
    expect(ws?.packages).toContain("libs/*");
  });

  it("detects nx.json", () => {
    writeFileSync(join(cwd, "nx.json"), "{}");
    const ws = detectWorkspace(cwd);
    expect(ws).not.toBeNull();
    expect(ws?.type).toBe("nx");
    expect(ws?.packages.length).toBeGreaterThan(0);
  });

  it("detects turbo.json", () => {
    writeFileSync(join(cwd, "turbo.json"), "{}");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] })
    );
    const ws = detectWorkspace(cwd);
    expect(ws).not.toBeNull();
    expect(ws?.type).toBe("turbo");
    expect(ws?.packages).toContain("packages/*");
  });

  it("detects package.json workspaces", () => {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ workspaces: ["packages/*", "apps/*"] })
    );
    const ws = detectWorkspace(cwd);
    expect(ws).not.toBeNull();
    expect(ws?.type).toBe("npm");
    expect(ws?.packages).toContain("packages/*");
    expect(ws?.packages).toContain("apps/*");
  });

  it("returns null for non-monorepo projects", () => {
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "foo" }));
    const ws = detectWorkspace(cwd);
    expect(ws).toBeNull();
  });

  it("maps changed file path to package name", () => {
    writeFileSync(
      join(cwd, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n"
    );
    mkdirSync(join(cwd, "packages/cli/src"), { recursive: true });
    const ws = detectWorkspace(cwd);
    expect(ws).not.toBeNull();
    const pkg = getPackageForFile(
      join(cwd, "packages/cli/src/foo.ts"),
      ws!
    );
    expect(pkg).toBe("cli");
  });

  it("auto-detects scope from staged files in single package", () => {
    writeFileSync(
      join(cwd, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n"
    );
    mkdirSync(join(cwd, "packages/cli/src"), { recursive: true });
    const ws = detectWorkspace(cwd)!;
    const scope = autoDetectScope(
      [
        join(cwd, "packages/cli/src/foo.ts"),
        join(cwd, "packages/cli/src/bar.ts"),
      ],
      ws
    );
    expect(scope).toBe("cli");
  });

  it("returns comma-joined scope when multiple packages", () => {
    writeFileSync(
      join(cwd, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n"
    );
    const ws = detectWorkspace(cwd)!;
    const scope = autoDetectScope(
      [
        join(cwd, "packages/cli/src/foo.ts"),
        join(cwd, "packages/api/src/bar.ts"),
      ],
      ws
    );
    expect(scope).not.toBeNull();
    expect(scope!).toContain("cli");
    expect(scope!).toContain("api");
  });

  it("returns null when scope is ambiguous (many packages)", () => {
    writeFileSync(
      join(cwd, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n"
    );
    const ws = detectWorkspace(cwd)!;
    const scope = autoDetectScope(
      [
        join(cwd, "packages/a/foo.ts"),
        join(cwd, "packages/b/bar.ts"),
        join(cwd, "packages/c/baz.ts"),
        join(cwd, "packages/d/qux.ts"),
      ],
      ws
    );
    expect(scope).toBeNull();
  });
});
