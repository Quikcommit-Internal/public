import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { MOCK_HOME } = vi.hoisted(() => ({ MOCK_HOME: "/mock/home" }));
const CONFIG_ROOT = `${MOCK_HOME}/.config/qc`;

const {
  mockGetConfig,
  mockGetApiKey,
  mockFetch,
  mockExistsSync,
  mockReadFileSync,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn<[], Record<string, unknown>>(() => ({})),
  mockGetApiKey: vi.fn<[], string | null>(() => null),
  mockFetch: vi.fn(),
  mockExistsSync: vi.fn<(path: string) => boolean>(() => false),
  mockReadFileSync: vi.fn<(path: string, encoding: string) => string>(() => ""),
}));

vi.mock("os", () => ({
  homedir: () => MOCK_HOME,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) =>
      mockExistsSync(String(path)),
    readFileSync: (path: Parameters<typeof actual.readFileSync>[0], encoding: BufferEncoding) =>
      mockReadFileSync(String(path), encoding),
  };
});

vi.mock("../src/config.js", () => ({
  getConfig: () => mockGetConfig(),
  getApiKey: () => mockGetApiKey(),
}));

vi.mock("../src/git.js", () => ({
  isGitRepo: vi.fn(() => true),
  hasStagedChanges: vi.fn(() => true),
  getStagedDiff: vi.fn(() => "diff --git a/foo.ts b/foo.ts\n+line"),
  getStagedFiles: vi.fn(() => "src/foo.ts\n"),
  getRecentBranchCommits: vi.fn(() => ["feat: prior commit"]),
  getStagedDiffShortstat: vi.fn(() => ({ additions: 1, deletions: 0 })),
  branchExists: vi.fn(() => false),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  getPushStats: vi.fn(() => null),
  getCurrentBranch: vi.fn(() => "main"),
  getCommitHash: vi.fn(() => "abc1234"),
  createBranch: vi.fn(),
  createAndCheckoutBranch: vi.fn(),
  gitPushSetUpstream: vi.fn(),
}));

vi.mock("../src/ui.js", () => ({
  getUI: () => ({
    log: { step: vi.fn(), dim: vi.fn(), success: vi.fn() },
    isColor: true,
    theme: {
      success: (s: string) => s,
      dim: (s: string) => s,
    },
  }),
}));

vi.mock("../src/ui-rich.js", () => ({
  createStageSpinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  flashSuccess: vi.fn().mockResolvedValue(undefined),
  buildUIContext: () => ({ animate: false, isTTY: false }),
}));

vi.mock("../src/monorepo.js", () => ({
  detectWorkspace: () => null,
  autoDetectScope: () => null,
}));

vi.mock("../src/commitlint.js", () => ({
  detectCommitlintRules: vi.fn().mockResolvedValue({}),
}));

vi.mock("../src/smart-diff.js", () => ({
  preprocessDiffWithSizeBudget: (diff: string) => ({
    processedDiff: diff,
    summarized: [],
    tokensSaved: 0,
    needsChunking: false,
  }),
}));

vi.mock("../src/commit-helpers.js", () => ({
  applyCliTypeScopeToRules: (rules: unknown) => rules,
  generationHintsFromArgs: () => undefined,
  interactiveRefineMessage: vi.fn(),
  confirmCommit: vi.fn(),
  shouldSkipTTYInteraction: () => true,
  logVerboseDiagnostics: vi.fn(),
  createSilentLog: () => ({ step: vi.fn(), dim: vi.fn(), success: vi.fn() }),
  displayCommitMessage: vi.fn(),
}));

import { getLocalProviderConfig, generateLocalBranchName, runLocalCommit } from "../src/local.js";
import * as gitMod from "../src/git.js";

function setupLegacyFiles(
  provider: string,
  opts?: { baseUrl?: string; model?: string }
): void {
  mockGetConfig.mockReturnValue({});
  mockExistsSync.mockImplementation((path) => {
    if (path === `${CONFIG_ROOT}/provider`) return true;
    if (opts?.baseUrl && path === `${CONFIG_ROOT}/base_url`) return true;
    if (opts?.model && path === `${CONFIG_ROOT}/model`) return true;
    return false;
  });
  mockReadFileSync.mockImplementation((path) => {
    if (path === `${CONFIG_ROOT}/provider`) return provider;
    if (path === `${CONFIG_ROOT}/base_url`) return opts?.baseUrl ?? "";
    if (path === `${CONFIG_ROOT}/model`) return opts?.model ?? "";
    return "";
  });
}

function mockFetchJson(data: unknown, ok = true, status = 200): void {
  mockFetch.mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(data),
    json: async () => data,
  });
}

function getLastFetchBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

function getLastFetchUrl(): string {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return call[0] as string;
}

function getLastFetchHeaders(): Record<string, string> {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return call[1].headers as Record<string, string>;
}

describe("getLocalProviderConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({});
    mockGetApiKey.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("");
  });

  it("returns null when no provider is configured", () => {
    expect(getLocalProviderConfig()).toBeNull();
  });

  it("detects ollama from config.json with default base URL and model", () => {
    mockGetConfig.mockReturnValue({ provider: "ollama" });
    expect(getLocalProviderConfig()).toEqual({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "codellama",
      apiKey: null,
    });
  });

  it("detects lmstudio from legacy provider file", () => {
    setupLegacyFiles("lmstudio");
    expect(getLocalProviderConfig()).toEqual({
      provider: "lmstudio",
      baseUrl: "http://localhost:1234/v1",
      model: "default",
      apiKey: null,
    });
  });

  it("detects openrouter when api key is present", () => {
    mockGetConfig.mockReturnValue({
      provider: "openrouter",
      model: "anthropic/claude-3-haiku",
    });
    mockGetApiKey.mockReturnValue("or-key-123");
    expect(getLocalProviderConfig()).toEqual({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-3-haiku",
      apiKey: "or-key-123",
    });
  });

  it("returns null for openrouter without api key", () => {
    mockGetConfig.mockReturnValue({ provider: "openrouter" });
    mockGetApiKey.mockReturnValue(null);
    expect(getLocalProviderConfig()).toBeNull();
  });

  it("detects cloudflare when api_url is set", () => {
    mockGetConfig.mockReturnValue({
      provider: "cloudflare",
      apiUrl: "https://ai.example.workers.dev/",
      model: "@cf/custom-model",
    });
    expect(getLocalProviderConfig()).toEqual({
      provider: "cloudflare",
      baseUrl: "https://ai.example.workers.dev/",
      model: "@cf/custom-model",
      apiKey: null,
    });
  });

  it("detects custom provider with api_url and api key", () => {
    mockGetConfig.mockReturnValue({
      provider: "custom",
      apiUrl: "https://my-llm.example/v1",
      model: "my-model",
    });
    mockGetApiKey.mockReturnValue("custom-key");
    expect(getLocalProviderConfig()).toEqual({
      provider: "custom",
      baseUrl: "https://my-llm.example/v1",
      model: "my-model",
      apiKey: "custom-key",
    });
  });

  it("prefers config.json over legacy files", () => {
    setupLegacyFiles("ollama", { baseUrl: "http://legacy:11434", model: "legacy-model" });
    mockGetConfig.mockReturnValue({
      provider: "lmstudio",
      apiUrl: "http://config:1234/v1",
      model: "config-model",
    });
    expect(getLocalProviderConfig()).toEqual({
      provider: "lmstudio",
      baseUrl: "http://config:1234/v1",
      model: "config-model",
      apiKey: null,
    });
  });
});

describe("generateLocalBranchName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({});
    mockGetApiKey.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("");
    (gitMod.branchExists as ReturnType<typeof vi.fn>).mockReturnValue(false);
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds branch prompt with description for ollama and posts to /api/generate", async () => {
    mockGetConfig.mockReturnValue({ provider: "ollama" });
    mockFetchJson({ response: "feat/oauth-login\n" });

    const name = await generateLocalBranchName({ description: "add oauth login" });

    expect(getLastFetchUrl()).toBe("http://localhost:11434/api/generate");
    const body = getLastFetchBody();
    expect(body.stream).toBe(false);
    expect(body.prompt).toContain("Generate a git branch name");
    expect(body.prompt).toContain("DESCRIPTION:");
    expect(body.prompt).toContain("add oauth login");
    expect(name).toBe("feat/oauth-login");
  });

  it("posts to lmstudio chat/completions with branch system prompt", async () => {
    mockGetConfig.mockReturnValue({ provider: "lmstudio" });
    mockFetchJson({
      choices: [{ message: { content: "fix/login-bug" } }],
    });

    const name = await generateLocalBranchName({ description: "fix login bug" });

    expect(getLastFetchUrl()).toBe("http://localhost:1234/v1/chat/completions");
    const body = getLastFetchBody();
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain("branch names");
    expect(messages[1].content).toContain("fix login bug");
    expect(name).toBe("fix/login-bug");
  });

  it("posts to openrouter with referer headers and parses choices content", async () => {
    mockGetConfig.mockReturnValue({ provider: "openrouter" });
    mockGetApiKey.mockReturnValue("or-secret");
    mockFetchJson({
      choices: [{ message: { content: "feat/new-api\nextra line ignored" } }],
    });

    const name = await generateLocalBranchName({ description: "new api endpoint" });

    expect(getLastFetchUrl()).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(getLastFetchHeaders().Authorization).toBe("Bearer or-secret");
    expect(getLastFetchHeaders()["HTTP-Referer"]).toBe(
      "https://github.com/Quikcommit-Internal/public"
    );
    expect(getLastFetchHeaders()["X-Title"]).toBe("qc - AI Commit Message Generator");
    expect(name).toBe("feat/new-api");
  });

  it("posts to custom openai-compat endpoint and parses choices content", async () => {
    mockGetConfig.mockReturnValue({
      provider: "custom",
      apiUrl: "https://llm.local/v1",
      model: "local-model",
    });
    mockGetApiKey.mockReturnValue("custom-token");
    mockFetchJson({
      choices: [{ message: { content: "feat/custom-branch" } }],
    });

    const name = await generateLocalBranchName({ description: "custom branch flow" });

    expect(getLastFetchUrl()).toBe("https://llm.local/v1/chat/completions");
    expect(getLastFetchHeaders().Authorization).toBe("Bearer custom-token");
    expect(name).toBe("feat/custom-branch");
  });

  it("posts to cloudflare /branch and parses branch.name", async () => {
    mockGetConfig.mockReturnValue({
      provider: "cloudflare",
      apiUrl: "https://worker.example.workers.dev/",
    });
    mockFetchJson({
      branch: { name: "refactor/auth-module" },
    });

    const name = await generateLocalBranchName({
      description: "refactor auth",
      diff: "+const x = 1",
      changes: "src/auth.ts",
      rules: { types: ["refactor"] },
    });

    expect(getLastFetchUrl()).toBe("https://worker.example.workers.dev/branch");
    const body = getLastFetchBody();
    expect(body.diff).toBe("+const x = 1");
    expect(body.changes).toBe("src/auth.ts");
    expect(body.description).toBe("refactor auth");
    expect(body.rules).toEqual({ types: ["refactor"] });
    expect(name).toBe("refactor/auth-module");
  });

  it("falls back to deterministicBranchName on network error", async () => {
    mockGetConfig.mockReturnValue({ provider: "ollama" });
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const name = await generateLocalBranchName({
      description: "add login",
      changes: "src/auth.ts",
    });

    expect(name).toBe("feat/add-login");
    expect(gitMod.branchExists).toHaveBeenCalled();
  });

  it("falls back to deterministicBranchName on HTTP error", async () => {
    mockGetConfig.mockReturnValue({ provider: "ollama" });
    mockFetchJson({ error: "model not found" }, false, 404);

    const name = await generateLocalBranchName({
      description: "add login",
      changes: "src/auth.ts",
    });

    expect(name).toBe("feat/add-login");
  });

  it("falls back when AI response cannot be sanitized", async () => {
    mockGetConfig.mockReturnValue({ provider: "ollama" });
    mockFetchJson({ response: "not a valid branch name at all" });

    const name = await generateLocalBranchName({
      description: "add login",
      changes: "src/auth.ts",
    });

    expect(name).toBe("feat/add-login");
  });
});

describe("runLocalCommit request construction", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  const baseArgs = {
    messageOnly: true,
    push: false,
    exclude: [],
    noSmartDiff: true,
    noContext: true,
    split: false,
    forceBody: false,
    interactive: false,
    confirm: false,
    verbose: false,
    quiet: true,
    dryRun: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({});
    mockGetApiKey.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("");
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("builds ollama generate request with commit prompt in prompt field", async () => {
    mockGetConfig.mockReturnValue({ provider: "ollama", model: "llama3" });
    mockFetchJson({ response: "feat(foo): add feature" });

    await runLocalCommit(baseArgs);

    expect(getLastFetchUrl()).toBe("http://localhost:11434/api/generate");
    const body = getLastFetchBody();
    expect(body.model).toBe("llama3");
    expect(body.stream).toBe(false);
    expect(body.prompt).toContain("## File changes:");
    expect(body.prompt).toContain("src/foo.ts");
    expect(body.prompt).toContain("## Diff:");
    expect(getLastFetchHeaders()).toEqual({ "Content-Type": "application/json" });
    expect(consoleLogSpy).toHaveBeenCalledWith("feat(foo): add feature");
  });

  it("builds lmstudio openai-compat request with system and user messages", async () => {
    mockGetConfig.mockReturnValue({ provider: "lmstudio" });
    mockFetchJson({
      choices: [{ message: { content: "fix: patch bug" } }],
    });

    await runLocalCommit(baseArgs);

    expect(getLastFetchUrl()).toBe("http://localhost:1234/v1/chat/completions");
    const body = getLastFetchBody();
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("commit message generator");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("conventional commit");
    expect(consoleLogSpy).toHaveBeenCalledWith("fix: patch bug");
  });

  it("builds openrouter request with auth and referer headers", async () => {
    mockGetConfig.mockReturnValue({ provider: "openrouter" });
    mockGetApiKey.mockReturnValue("or-key");
    mockFetchJson({
      choices: [{ message: { content: "docs: update readme" } }],
    });

    await runLocalCommit(baseArgs);

    expect(getLastFetchUrl()).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(getLastFetchHeaders().Authorization).toBe("Bearer or-key");
    expect(getLastFetchHeaders()["HTTP-Referer"]).toBe(
      "https://github.com/Quikcommit-Internal/public"
    );
    expect(getLastFetchHeaders()["X-Title"]).toBe("qc - AI Commit Message Generator");
  });

  it("builds custom provider request like openai-compat with bearer token", async () => {
    mockGetConfig.mockReturnValue({
      provider: "custom",
      apiUrl: "https://llm.local/v1",
      model: "local-model",
    });
    mockGetApiKey.mockReturnValue("custom-token");
    mockFetchJson({
      choices: [{ message: { content: "chore: tidy deps" } }],
    });

    await runLocalCommit(baseArgs);

    expect(getLastFetchUrl()).toBe("https://llm.local/v1/chat/completions");
    expect(getLastFetchHeaders().Authorization).toBe("Bearer custom-token");
    const body = getLastFetchBody();
    expect(body.model).toBe("local-model");
    expect(body.messages).toBeDefined();
  });

  it("builds cloudflare /commit request with diff, changes, and rules", async () => {
    mockGetConfig.mockReturnValue({
      provider: "cloudflare",
      apiUrl: "https://ai.worker.dev/",
    });
    mockFetchJson({
      commit: { response: "feat(api): add endpoint" },
    });

    await runLocalCommit({ ...baseArgs, split: true, forceBody: true });

    expect(getLastFetchUrl()).toBe("https://ai.worker.dev/commit");
    const body = getLastFetchBody();
    expect(body.diff).toContain("diff --git");
    expect(body.changes).toBe("src/foo.ts\n");
    expect(body.rules).toBeDefined();
    expect(consoleLogSpy).toHaveBeenCalledWith("feat(api): add endpoint");
  });
});
