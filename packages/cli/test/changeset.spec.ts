import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  generateSlug,
  formatChangesetFile,
  mapFilesToPackages,
} from "../src/commands/changeset.js";
import type { WorkspaceInfo } from "../src/monorepo.js";

describe("generateSlug", () => {
  it("returns a three-word hyphenated slug", () => {
    const slug = generateSlug();
    const parts = slug.split("-");
    expect(parts).toHaveLength(3);
    expect(slug).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it("generates different slugs on repeated calls (probabilistic)", () => {
    const slugs = new Set(Array.from({ length: 20 }, generateSlug));
    expect(slugs.size).toBeGreaterThan(1);
  });
});

describe("formatChangesetFile", () => {
  it("produces valid changeset frontmatter with one package", () => {
    const content = formatChangesetFile(
      [{ name: "@quikcommit/cli", bump: "minor" }],
      "feat: add changeset command"
    );
    expect(content).toBe(
      `---\n"@quikcommit/cli": minor\n---\n\nfeat: add changeset command\n`
    );
  });

  it("produces valid changeset frontmatter with multiple packages", () => {
    const content = formatChangesetFile(
      [
        { name: "@quikcommit/cli", bump: "minor" },
        { name: "@quikcommit/shared", bump: "patch" },
      ],
      "feat: multi-package change"
    );
    expect(content).toContain('"@quikcommit/cli": minor');
    expect(content).toContain('"@quikcommit/shared": patch');
    expect(content).toContain("feat: multi-package change");
  });
});

describe("mapFilesToPackages", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "qc-changeset-"));
    // Create workspace structure:  cwd/packages/cli/package.json
    mkdirSync(join(cwd, "packages", "cli"), { recursive: true });
    mkdirSync(join(cwd, "packages", "shared"), { recursive: true });
    writeFileSync(
      join(cwd, "packages", "cli", "package.json"),
      JSON.stringify({ name: "@quikcommit/cli", version: "0.1.0" })
    );
    writeFileSync(
      join(cwd, "packages", "shared", "package.json"),
      JSON.stringify({ name: "@quikcommit/shared", version: "0.1.0" })
    );
  });

  it("maps changed files to package names from package.json", () => {
    const workspace: WorkspaceInfo = {
      type: "pnpm",
      packages: ["packages/*"],
      root: cwd,
    };

    const result = mapFilesToPackages(
      ["packages/cli/src/index.ts", "packages/shared/src/types.ts"],
      workspace
    );

    expect(result.get("cli")).toBe("@quikcommit/cli");
    expect(result.get("shared")).toBe("@quikcommit/shared");
    expect(result.size).toBe(2);
  });

  it("deduplicates files from the same package", () => {
    const workspace: WorkspaceInfo = {
      type: "pnpm",
      packages: ["packages/*"],
      root: cwd,
    };

    const result = mapFilesToPackages(
      [
        "packages/cli/src/index.ts",
        "packages/cli/src/api.ts",
        "packages/cli/src/commands/pr.ts",
      ],
      workspace
    );

    expect(result.size).toBe(1);
    expect(result.get("cli")).toBe("@quikcommit/cli");
  });

  it("ignores files outside workspace packages", () => {
    const workspace: WorkspaceInfo = {
      type: "pnpm",
      packages: ["packages/*"],
      root: cwd,
    };

    const result = mapFilesToPackages(
      ["packages/cli/src/index.ts", ".github/workflows/ci.yml", "README.md"],
      workspace
    );

    expect(result.size).toBe(1);
  });

  it("falls back to directory name when package.json is missing", () => {
    const workspace: WorkspaceInfo = {
      type: "pnpm",
      packages: ["packages/*"],
      root: cwd,
    };
    // packages/unknown has no package.json
    mkdirSync(join(cwd, "packages", "unknown"), { recursive: true });

    const result = mapFilesToPackages(
      ["packages/unknown/src/index.ts"],
      workspace
    );

    expect(result.get("unknown")).toBe("unknown");
  });
});
