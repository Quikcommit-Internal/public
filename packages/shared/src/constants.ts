import type { PlanTier } from "./types.js";

export interface ModelInfo {
  id: string;
  name: string;
  provider: "cloudflare";
  cf_model: string;
  /** Model's context window size in tokens. Used by AI worker for truncation. */
  context_window: number;
  tier: "free" | "pro";
  cost_per_commit: number;
  description: string;
}

export const MODEL_CATALOG: ModelInfo[] = [
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    provider: "cloudflare",
    cf_model: "@cf/moonshotai/kimi-k2.6",
    context_window: 262_144,
    tier: "free",
    cost_per_commit: 0.001,
    description: "1T MoE model. 262K context. Default for all tiers.",
  },
];

export const DEFAULT_MODEL = "kimi-k2.6";

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

/** Resolve model ID to cf_model, or default. Validates tier access. */
export function resolveModel(
  modelId: string | undefined,
  plan: PlanTier
): { cf_model: string; model_id: string; context_window: number } | { error: string } {
  const id = modelId?.trim() || DEFAULT_MODEL;
  const info = MODEL_CATALOG.find((m) => m.id === id);
  if (!info) {
    return { error: `Unknown model: ${id}. Available: ${MODEL_CATALOG.map(m => m.id).join(", ")}` };
  }
  if (!planMeetsModelTier(plan, info.tier)) {
    return { error: `Model ${id} requires Pro plan` };
  }
  return { cf_model: info.cf_model, model_id: info.id, context_window: info.context_window };
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

/** Max length for `current_branch` on PR requests (prompt size / abuse guard) */
export const MAX_PR_CURRENT_BRANCH_CHARS = 256;
export const DEVICE_POLL_INTERVAL = 1000;
export const DEVICE_FLOW_TIMEOUT = 600_000;
