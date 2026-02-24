/** Commit rules from commitlint config */
export interface CommitRules {
  scopes?: string[];
  scopeDelimiters?: string[];
  types?: string[];
  typeCase?: string | string[];
  scopeCase?: string | string[];
  subjectCase?: string | string[];
  headerMaxLength?: number;
  subjectMaxLength?: number;
  bodyMaxLineLength?: number;
  subjectFullStop?: string;
}

/** API request: generate commit message */
export interface CommitRequest {
  diff: string;
  changes: string;
  rules?: CommitRules;
  model?: string;
}

/** API request: generate PR description */
export interface PRRequest {
  commits: string[];
  diff_stat: string;
  base_branch: string;
  rules?: CommitRules;
  model?: string;
}

/** API request: generate changelog */
export interface ChangelogRequest {
  commits_by_type: Record<string, string[]>;
  from_tag: string;
  to_ref: string;
  model?: string;
}

/** API response: generation result */
export interface GenerationResponse {
  message: string;
  diagnostics?: {
    model: string;
    tokens_used: number;
    truncated: boolean;
  };
}

/** API response: usage stats */
export interface UsageResponse {
  plan: PlanTier;
  period: string;
  commit_count: number;
  pr_count: number;
  changelog_count: number;
  limit: number;
  remaining: number;
}

/** API response: error */
export interface ErrorResponse {
  error: string;
  code: string;
  upgrade_url?: string;
  usage?: UsageResponse;
}

/** Diagnostics about which commit rules were applied */
export interface RulesAppliedDiagnostics {
  hasScopes: boolean;
  hasCustomTypes: boolean;
  scopeCount: number;
}

/** Token usage breakdown from AI Worker */
export interface TokenUsageDiagnostics {
  diffTokens: number;
  overheadTokens: number;
  totalEstimated: number;
  modelLimit: number;
  utilizationPercent: number;
  remainingTokens: number;
  warning?: string;
}

/** Raw response from AI Worker */
export interface AIWorkerResponse {
  commit: {
    response: string;
  };
  diagnostics?: {
    model: string;
    diffTruncated: boolean;
    truncationSummary: string;
    estimatedTokens: number;
    tokenUsage: TokenUsageDiagnostics;
    rulesApplied: RulesAppliedDiagnostics;
  };
}

/** AI Worker response shape: PR description */
export interface PRWorkerResponse {
  pr: {
    response: string;
  };
}

/** AI Worker response shape: changelog entry */
export interface ChangelogWorkerResponse {
  changelog: {
    response: string;
  };
}

/** API request: generate changeset */
export interface ChangesetRequest {
  diff: string;
  packages: string[];   // workspace package names (e.g. ["@quikcommit/cli"])
  commits: string;      // git log --oneline output for context
  model?: string;
}

/** API response: changeset classification */
export interface ChangesetResponse {
  packages: Array<{
    name: string;
    bump: "major" | "minor" | "patch";
    reason: string;
  }>;
  summary: string;
}

/** AI Worker response shape: changeset (bump validated server-side) */
export interface ChangesetWorkerResponse {
  changeset: {
    packages: Array<{
      name: string;
      bump: "major" | "minor" | "patch";
      reason: string;
    }>;
    summary: string;
  };
}

export type PlanTier = "free" | "pro" | "team" | "scale";
