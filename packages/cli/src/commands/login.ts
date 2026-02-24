import { execFileSync } from "child_process";
import { platform } from "os";
import { saveApiKey } from "../config.js";
import {
  DEFAULT_API_URL,
  DEVICE_POLL_INTERVAL,
  DEVICE_FLOW_TIMEOUT,
} from "@quikcommit/shared";

const API_URL = process.env.QC_API_URL ?? DEFAULT_API_URL;
const DASHBOARD_URL = "https://app.quikcommit.dev";

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

export async function runLogin(): Promise<void> {
  // Issue #13: device code is now generated server-side (RFC 8628 §3.1).
  // Send an empty body; the server returns the authoritative device_code.
  const startRes = await fetch(`${API_URL}/v1/auth/device/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({ error: startRes.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to start device flow");
  }

  const startData = (await startRes.json()) as { device_code?: string; status?: string };
  const code = startData.device_code;
  if (!code) {
    throw new Error("Server did not return a device_code");
  }

  console.log("Opening browser to sign in...");
  console.log("");

  const authUrl = `${DASHBOARD_URL}/auth/cli?code=${encodeURIComponent(code)}`;
  const opened = openBrowser(authUrl);
  if (!opened) {
    console.log("Could not open browser. Please visit:");
    console.log(authUrl);
    console.log("");
  }

  const startTime = Date.now();
  while (Date.now() - startTime < DEVICE_FLOW_TIMEOUT) {
    try {
      const res = await fetch(
        `${API_URL}/v1/auth/device/poll?code=${encodeURIComponent(code)}`
      );
      const data = (await res.json()) as { status: string; api_key?: string };

      if (data.status === "complete" && data.api_key) {
        saveApiKey(data.api_key);
        console.log("Successfully logged in!");
        return;
      }
    } catch {
      // Ignore transient poll errors and retry on next interval.
    }

    await new Promise((r) => setTimeout(r, DEVICE_POLL_INTERVAL));
  }

  console.error("Login timed out. Please try again.");
  process.exit(1);
}
