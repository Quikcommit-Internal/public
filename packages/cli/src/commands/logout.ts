import { clearApiKey } from "../config.js";

export function runLogout(): void {
  clearApiKey();
  console.log("Logged out. Credentials cleared.");
}
