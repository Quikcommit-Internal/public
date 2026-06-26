import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import {
  CONFIG_DIR,
  CREDENTIALS_FILE,
  CONFIG_FILE,
} from "@quikcommit/shared";

vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from "fs";
import {
  getApiKey,
  saveApiKey,
  clearApiKey,
  getConfig,
  saveConfig,
} from "../src/config.js";

const CONFIG_PATH = join("/mock/home", CONFIG_DIR);
const CREDENTIALS_PATH = join(CONFIG_PATH, CREDENTIALS_FILE);
const CONFIG_JSON_PATH = join(CONFIG_PATH, CONFIG_FILE);

describe("config file I/O", () => {
  const originalApiKey = process.env.QC_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QC_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.QC_API_KEY;
    } else {
      process.env.QC_API_KEY = originalApiKey;
    }
  });

  describe("getApiKey()", () => {
    it("returns QC_API_KEY from environment when set", () => {
      process.env.QC_API_KEY = "  env-key  ";

      expect(getApiKey()).toBe("env-key");
      expect(existsSync).not.toHaveBeenCalled();
    });

    it("returns key from credentials file", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("file-key\n");

      expect(getApiKey()).toBe("file-key");
      expect(existsSync).toHaveBeenCalledWith(CREDENTIALS_PATH);
      expect(readFileSync).toHaveBeenCalledWith(CREDENTIALS_PATH, "utf-8");
    });

    it("returns null when credentials file is missing", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(getApiKey()).toBeNull();
    });

    it("returns null on read error", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("EACCES");
      });

      expect(getApiKey()).toBeNull();
    });
  });

  describe("saveApiKey()", () => {
    it("writes trimmed key with correct directory and file permissions", () => {
      saveApiKey("  my-api-key  ");

      expect(mkdirSync).toHaveBeenCalledWith(CONFIG_PATH, {
        recursive: true,
        mode: 0o700,
      });
      expect(writeFileSync).toHaveBeenCalledWith(CREDENTIALS_PATH, "my-api-key", {
        mode: 0o600,
      });
    });
  });

  describe("clearApiKey()", () => {
    it("unlinks credentials file when it exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      clearApiKey();

      expect(existsSync).toHaveBeenCalledWith(CREDENTIALS_PATH);
      expect(unlinkSync).toHaveBeenCalledWith(CREDENTIALS_PATH);
    });

    it("does nothing when credentials file is missing", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      clearApiKey();

      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it("ignores unlink errors", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(unlinkSync).mockImplementation(() => {
        throw new Error("EBUSY");
      });

      expect(() => clearApiKey()).not.toThrow();
    });
  });

  describe("getConfig()", () => {
    it("returns parsed JSON from config file", () => {
      const config = { provider: "ollama", model: "llama3" };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));

      expect(getConfig()).toEqual(config);
      expect(readFileSync).toHaveBeenCalledWith(CONFIG_JSON_PATH, "utf-8");
    });

    it("returns empty object when config file is missing", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(getConfig()).toEqual({});
    });

    it("returns empty object when config file is corrupt", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("{ not valid json");

      expect(getConfig()).toEqual({});
    });
  });

  describe("saveConfig()", () => {
    it("writes pretty-printed JSON with correct permissions", () => {
      const config = { provider: "openrouter", autoStage: true };

      saveConfig(config);

      expect(mkdirSync).toHaveBeenCalledWith(CONFIG_PATH, {
        recursive: true,
        mode: 0o700,
      });
      expect(writeFileSync).toHaveBeenCalledWith(
        CONFIG_JSON_PATH,
        JSON.stringify(config, null, 2),
        { mode: 0o600 }
      );
    });
  });
});
