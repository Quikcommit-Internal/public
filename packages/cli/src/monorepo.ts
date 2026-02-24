import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";

export interface WorkspaceInfo {
  type: "pnpm" | "lerna" | "nx" | "turbo" | "npm";
  packages: string[];
  root: string;
}

function findGitRoot(start: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      cwd: start,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return start;
  }
}

export function detectWorkspace(cwd: string = findGitRoot(process.cwd())): WorkspaceInfo | null {
  const pnpmWs = join(cwd, "pnpm-workspace.yaml");
  if (existsSync(pnpmWs)) {
    const content = readFileSync(pnpmWs, "utf-8");
    const match = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)*)/);
    if (match) {
      const packages = match[1]
        .split("\n")
        .map((l) => l.replace(/^\s+-\s+/, "").replace(/["']/g, "").trim())
        .filter(Boolean);
      return { type: "pnpm", packages, root: cwd };
    }
  }

  const lerna = join(cwd, "lerna.json");
  if (existsSync(lerna)) {
    try {
      const config = JSON.parse(readFileSync(lerna, "utf-8"));
      return {
        type: "lerna",
        packages: config.packages ?? ["packages/*"],
        root: cwd,
      };
    } catch {
      // malformed lerna.json — skip
    }
  }

  if (existsSync(join(cwd, "nx.json"))) {
    return {
      type: "nx",
      packages: ["packages/*", "apps/*", "libs/*"],
      root: cwd,
    };
  }

  if (existsSync(join(cwd, "turbo.json"))) {
    const pkgPath = join(cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const config = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (config.workspaces) {
          const ws = Array.isArray(config.workspaces)
            ? config.workspaces
            : config.workspaces.packages ?? [];
          return { type: "turbo", packages: ws, root: cwd };
        }
      } catch {
        // malformed package.json — skip
      }
    }
  }

  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const config = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (config.workspaces) {
        const ws = Array.isArray(config.workspaces)
          ? config.workspaces
          : config.workspaces.packages ?? [];
        return { type: "npm", packages: ws, root: cwd };
      }
    } catch {
      // malformed package.json — skip
    }
  }

  return null;
}

function matchGlobPattern(rel: string, pattern: string): string | null {
  // Strip trailing glob wildcards to get the directory prefix
  const dir = pattern.replace(/\/?\*\*?$/, "").replace(/\/$/, "");

  if (!dir || dir === "*" || dir === "**") {
    // Pattern like "*" or "**" — match any top-level path component
    const pkg = rel.split("/")[0];
    return pkg || null;
  }

  // Handle patterns with a wildcard in the middle, e.g. "packages/*/src"
  const starIdx = dir.indexOf("*");
  if (starIdx !== -1) {
    const prefix = dir.slice(0, starIdx);
    if (rel.startsWith(prefix)) {
      const rest = rel.slice(prefix.length);
      const pkg = rest.split("/")[0];
      return pkg || null;
    }
    return null;
  }

  // Simple prefix pattern, e.g. "packages" or "apps"
  const prefix = dir + "/";
  if (rel.startsWith(prefix)) {
    const rest = rel.slice(prefix.length);
    const pkg = rest.split("/")[0];
    return pkg || null;
  }

  return null;
}

export function getPackageForFile(
  filePath: string,
  workspace: WorkspaceInfo
): string | null {
  const absPath = filePath.startsWith("/")
    ? filePath
    : join(workspace.root, filePath);
  const rel = relative(workspace.root, absPath);

  for (const pattern of workspace.packages) {
    const packageName = matchGlobPattern(rel, pattern);
    if (packageName) return packageName;
  }
  return null;
}

export function autoDetectScope(
  stagedFiles: string[],
  workspace: WorkspaceInfo
): string | null {
  const packages = new Set<string>();
  for (const file of stagedFiles) {
    const filePath = file.startsWith("/")
      ? file
      : join(workspace.root, file);
    const pkg = getPackageForFile(filePath, workspace);
    if (pkg) packages.add(pkg);
  }
  if (packages.size === 1) return [...packages][0];
  if (packages.size > 1 && packages.size <= 3) return [...packages].join(",");
  if (packages.size > 3) {
    console.error(
      `[qc] Changes span ${packages.size} packages; skipping auto-scope detection.`
    );
  }
  return null;
}
