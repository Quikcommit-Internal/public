import { getApiKey } from "../config.js";
import { ApiClient } from "../api.js";

export async function runStatus(apiKeyFlag?: string): Promise<void> {
  const apiKey = apiKeyFlag ?? getApiKey();

  if (!apiKey) {
    console.log("Not logged in. Run `qc login` to authenticate.");
    return;
  }

  console.log("Logged in: yes");
  console.log(`  API key: ...${apiKey.slice(-4)}`);

  const client = new ApiClient({ apiKey });
  const usage = await client.getUsage();
  if (usage) {
    console.log(`Plan: ${usage.plan}`);
    console.log(`Usage: ${usage.commit_count}/${usage.limit} commits this period`);
    console.log(`Remaining: ${usage.remaining}`);
  } else {
    console.log("Usage: (unable to fetch)");
  }
}
