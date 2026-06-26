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

/** Optional AI prompt hints for commit generation (CLI flags / gateway) */
export interface CommitGenerationHints {
  /** Prefer addressing multiple logical commits / how to split staged work */
  split?: boolean;
  /** Require a commit body even when the diff looks trivial */
  force_body?: boolean;
}

/** API request: generate commit message */
export interface CommitRequest {
  diff: string;
  changes: string;
  rules?: CommitRules;
  model?: string;
  recent_commits?: string[];
  /** Forwarded to AI worker to tune the user prompt */
  generation_hints?: CommitGenerationHints;
}

/** API request: generate PR description */
export interface PRRequest {
  commits: string[];
  diff_stat: string;
  base_branch: string;
  /** For checkbox selector context in repo PR templates */
  current_branch?: string;
  /** Content of `.github/pull_request_template.md` when present */
  pr_template?: string;
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
    title: string;
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

/** API request: generate branch name */
export interface BranchRequest {
  diff?: string;
  changes?: string;
  /** Compact per-file +/- stats from `git diff --stat`. */
  diff_stat?: string;
  recent_commits?: string[];
  description?: string;
  rules?: CommitRules;
  scope_hint?: string;
  model?: string;
}

/** API response: generated branch name */
export interface BranchResponse {
  name: string; // e.g. "feat/oauth-device-flow"
  type: string; // e.g. "feat"
  slug: string; // e.g. "oauth-device-flow"
  reasoning?: string;
}

/** AI Worker raw response shape */
export interface BranchWorkerResponse {
  branch: {
    name: string;
    type: string;
    slug: string;
    reasoning?: string;
  };
}

/** API request: summarize a diff chunk for multi-chunk commit flows */
export interface SummarizeRequest {
  diff: string;
  changes: string;
  model?: string;
}

/** API response: diff chunk summary */
export interface SummarizeResponse {
  summary: string;
}

/** UI / visual polish config. Used in .quikcommit.yml and ~/.config/qc/config.json. */
export interface UIConfig {
  readonly theme?: "vibrant" | "muted" | "mono";
  readonly adaptive?: boolean;
  readonly box?: {
    readonly style?: "rounded" | "gradient" | "double" | "none";
    readonly auto_emphasis?: boolean;
    readonly width?: number | "auto";
  };
  readonly animate?: "tasteful" | "full" | "none";
  readonly spinner?: "per-stage" | "uniform";
  readonly type_colors?: Readonly<Record<string, string>>;
}

/** Branch-related config in .quikcommit.yml or user config */
export interface BranchConfig {
  readonly protectedBranches?: string[];
  readonly detectDefault?: boolean;
  readonly allowProtected?: boolean;
  readonly defaultAction?: "branch" | "continue" | "prompt";
  readonly generation?: {
    readonly types?: string[];
  };
}
