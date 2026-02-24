const BILLING_URL = "https://app.quikcommit.dev/billing";

export async function upgrade(): Promise<void> {
  console.log(`\nOpening ${BILLING_URL}\n`);
  try {
    const { execFileSync } = await import("child_process");
    if (process.platform === "darwin") {
      execFileSync("open", [BILLING_URL]);
    } else if (process.platform === "linux") {
      execFileSync("xdg-open", [BILLING_URL]);
    } else if (process.platform === "win32") {
      execFileSync("cmd", ["/c", "start", "", BILLING_URL]);
    }
  } catch {
    console.log(`Visit: ${BILLING_URL}`);
  }
}
