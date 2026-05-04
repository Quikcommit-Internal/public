import { execFileSync } from "child_process";
import { platform } from "os";
import { saveApiKey } from "../config.js";
import {
  DEFAULT_API_URL,
  DEVICE_FLOW_TIMEOUT,
} from "@quikcommit/shared";

const API_URL = process.env.QC_API_URL ?? DEFAULT_API_URL;
const DASHBOARD_URL = "https://app.quikcommit.dev";
const CLIENT_ID = "qc-cli";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function openBrowser(url: string): boolean {
  try {
    if (platform() === "darwin") {
      execFileSync("open", [url], { stdio: "pipe" });
      return true;
    }
    if (platform() === "linux") {
      execFileSync("xdg-open", [url], { stdio: "pipe" });
      return true;
    }
    if (platform() === "win32") {
      execFileSync("cmd", ["/c", "start", "", url], { stdio: "pipe" });
      return true;
    }
  } catch {
    // Fall through to manual URL
  }
  return false;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval: number;
  expires_in: number;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export async function runLogin(): Promise<void> {
  // Step 1: Request device + user codes
  const codeRes = await fetch(`${API_URL}/api/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!codeRes.ok) {
    const err = (await codeRes.json().catch(() => ({ error: codeRes.statusText }))) as { error?: string };
    throw new Error(err.error ?? "Failed to start device flow");
  }

  const codeData = (await codeRes.json()) as DeviceCodeResponse;
  const { device_code, user_code, verification_uri_complete, interval = 5 } = codeData;

  if (!device_code || !user_code) {
    throw new Error("Server did not return device codes");
  }

  // Step 2: Show user code and open browser
  console.log("Opening browser to sign in...");
  console.log("");
  console.log(`  Your code: ${user_code}`);
  console.log("");

  const authUrl = verification_uri_complete ?? `${DASHBOARD_URL}/device?user_code=${encodeURIComponent(user_code)}`;
  const opened = openBrowser(authUrl);
  if (!opened) {
    console.log("Could not open browser. Please visit:");
    console.log(authUrl);
    console.log("");
  }

  // Step 3: Poll for token
  let frame = 0;
  const spinner = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stderr.write(
      `\r${SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length]} Waiting for authorization... (${elapsed}s)`
    );
  }, 80);

  let pollingInterval = interval * 1000;
  const startTime = Date.now();

  try {
    while (Date.now() - startTime < DEVICE_FLOW_TIMEOUT) {
      await new Promise((r) => setTimeout(r, pollingInterval));

      try {
        const tokenRes = await fetch(`${API_URL}/api/auth/device/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code,
            client_id: CLIENT_ID,
          }),
        });

        const tokenData = (await tokenRes.json()) as TokenResponse;

        if (tokenData.access_token) {
          saveApiKey(tokenData.access_token);
          process.stderr.write("\r\x1b[2K");
          console.log("Successfully logged in!");
          return;
        }

        if (tokenData.error) {
          switch (tokenData.error) {
            case "authorization_pending":
              break; // continue polling
            case "slow_down":
              pollingInterval += 5000;
              break;
            case "access_denied":
              process.stderr.write("\r\x1b[2K");
              console.error("Authorization was denied.");
              process.exit(1);
              break;
            case "expired_token":
              process.stderr.write("\r\x1b[2K");
              console.error("Device code expired. Please try again.");
              process.exit(1);
              break;
            default:
              process.stderr.write("\r\x1b[2K");
              console.error(`Error: ${tokenData.error_description ?? tokenData.error}`);
              process.exit(1);
          }
        }
      } catch {
        // Ignore transient network errors; retry on next interval
      }
    }

    process.stderr.write("\r\x1b[2K");
    console.error("Login timed out. Please try again.");
    process.exit(1);
  } finally {
    clearInterval(spinner);
  }
}
