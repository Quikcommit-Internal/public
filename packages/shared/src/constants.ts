import type { PlanTier } from "./types.js";

export interface ModelInfo {
  id: string;
  name: string;
  provider: "cloudflare";
  cf_model: string;
  tier: "free" | "pro";
  cost_per_commit: number;
  description: string;
}

export const MODEL_CATALOG: ModelInfo[] = [
  {
    id: "qwen3-30b",
    name: "Qwen3 30B",
    provider: "cloudflare",
    cf_model: "@cf/qwen/qwen3-30b-a3b-fp8",
    tier: "free",
    cost_per_commit: 0.000169,
    description: "Fast, good quality. Default for Free tier.",
  },
  {
    id: "qwen25-coder-32b",
    name: "Qwen 2.5 Coder 32B",
    provider: "cloudflare",
    cf_model: "@cf/qwen/qwen2.5-coder-32b-instruct",
    tier: "free",
    cost_per_commit: 0.00152,
    description: "Best code understanding. Default for Pro+.",
  },
  {
    id: "deepseek-r1-32b",
    name: "DeepSeek R1 32B",
    provider: "cloudflare",
    cf_model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    tier: "pro",
    cost_per_commit: 0.00197,
    description: "Reasoning model. Best for complex changes.",
  },
  {
    id: "llama-3.3-70b",
    name: "Llama 3.3 70B",
    provider: "cloudflare",
    cf_model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    tier: "pro",
    cost_per_commit: 0.00104,
    description: "Large model. Strong general understanding.",
  },
];

export const DEFAULT_MODEL_FREE = "qwen3-30b";
export const DEFAULT_MODEL_PRO = "qwen25-coder-32b";

const TIER_ORDER: PlanTier[] = ["free", "pro", "team", "scale"];

/** Check if user's plan meets the model's minimum tier */
export function planMeetsModelTier(
  userPlan: PlanTier,
  modelTier: "free" | "pro"
): boolean {
  const planIdx = TIER_ORDER.indexOf(userPlan);
  const modelIdx = TIER_ORDER.indexOf(modelTier);
  return planIdx >= modelIdx;
}

/** Resolve model ID to cf_model, or default based on plan. Validates tier access. */
export function resolveModel(
  modelId: string | undefined,
  plan: PlanTier
): { cf_model: string; model_id: string } | { error: string } {
  const defaultId =
    plan === "free" ? DEFAULT_MODEL_FREE : DEFAULT_MODEL_PRO;
  const id = modelId?.trim() || defaultId;
  const info = MODEL_CATALOG.find((m) => m.id === id);
  if (!info) {
    return { error: `Unknown model: ${id}` };
  }
  if (!planMeetsModelTier(plan, info.tier)) {
    return { error: "This model requires Pro plan" };
  }
  return { cf_model: info.cf_model, model_id: info.id };
}

export const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 50,
  pro: 500,
  team: 2000,
  scale: -1, // -1 means unlimited
};

export const RATE_LIMITS: Record<PlanTier, { rpm: number; burst: number }> = {
  free: { rpm: 10, burst: 15 },
  pro: { rpm: 30, burst: 50 },
  team: { rpm: 60, burst: 100 },
  scale: { rpm: 120, burst: 200 },
};

export const SCALE_PER_COMMIT_PRICE = 0.02;
export const API_VERSION = "v1";
export const CONFIG_DIR = ".config/qc";
export const CREDENTIALS_FILE = "credentials";
export const CONFIG_FILE = "config.json";
export const DEFAULT_API_URL = "https://api.quikcommit.dev";
export const DEVICE_POLL_INTERVAL = 2000;
export const DEVICE_FLOW_TIMEOUT = 600_000;
