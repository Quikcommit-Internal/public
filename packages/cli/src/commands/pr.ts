import { execFileSync } from "child_process";
import { getApiKey } from "../config.js";
import { ApiClient } from "../api.js";
import { getBranchCommits, getDiffStat } from "../git.js";

export async function pr(options: {
  base?: string;
  create?: boolean;
  model?: string;
}): Promise<void> {
  const base = options.base ?? "main";
  const commits = getBranchCommits(base);
  const diffStat = getDiffStat(base);

  if (commits.length === 0) {
    console.error(`No commits found on this branch vs ${base}`);
    process.exit(1);
  }

  console.error(`Generating PR description from ${commits.length} commits...`);

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("Error: Not authenticated. Run `qc login` first.");
    process.exit(1);
  }

  const client = new ApiClient({ apiKey });
  const result = await client.generatePR(
    {
      commits,
      diff_stat: diffStat,
      base_branch: base,
    },
    options.model
  );

  console.log("\n" + result.message + "\n");

  if (options.create) {
    try {
      const title = result.message.split("\n").find((l) => l.trim()) ?? result.message.substring(0, 72).trim();
      execFileSync("gh", ["pr", "create", "--title", title, "--body", result.message], {
        stdio: "inherit",
      });
    } catch {
      console.error("Error: `gh` CLI not found or failed. Install from https://cli.github.com/");
      process.exit(1);
    }
  }
}
