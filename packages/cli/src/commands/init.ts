import { existsSync, writeFileSync, unlinkSync, readFileSync, chmodSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";

const HOOK_CONTENT = `#!/bin/sh
# Quikcommit - auto-generate commit messages
# Installed by: qc init
# Remove with: qc init --uninstall

# Only generate if no message was provided (empty commit message file)
COMMIT_MSG_FILE="$1"
COMMIT_SOURCE="$2"

# Skip if message was provided via -m, merge, squash, etc.
if [ -n "$COMMIT_SOURCE" ]; then
  exit 0
fi

# Skip if message file already has content (excluding comments)
if grep -qv '^#' "$COMMIT_MSG_FILE" 2>/dev/null; then
  if [ -n "$(grep -v '^#' "$COMMIT_MSG_FILE" | grep -v '^$')" ]; then
    exit 0
  fi
fi

# Generate commit message
MSG=$(qc --message-only --hook-mode 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$MSG" ]; then
  printf '%s\n' "$MSG" > "$COMMIT_MSG_FILE"
fi
`;

export function init(options: { uninstall?: boolean }): void {
  let hooksDir: string;
  try {
    hooksDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    console.error("Error: Not a git repository");
    process.exit(1);
  }

  const hookPath = join(hooksDir, "prepare-commit-msg");

  if (options.uninstall) {
    if (existsSync(hookPath)) {
      const content = readFileSync(hookPath, "utf-8");
      if (content.includes("Quikcommit")) {
        unlinkSync(hookPath);
        console.log("Quikcommit hook removed.");
      } else {
        console.log("Hook exists but was not installed by Quikcommit. Skipping.");
      }
    } else {
      console.log("No hook to remove.");
    }
    return;
  }

  if (existsSync(hookPath)) {
    const content = readFileSync(hookPath, "utf-8");
    if (content.includes("Quikcommit")) {
      console.log("Quikcommit hook is already installed.");
      return;
    }
    console.error(
      "A prepare-commit-msg hook already exists. Use --uninstall first or manually merge."
    );
    process.exit(1);
  }

  writeFileSync(hookPath, HOOK_CONTENT);
  chmodSync(hookPath, 0o755);
  console.log("Quikcommit hook installed.");
  console.log("Now just run `git commit` and a message will be generated automatically.");
}
