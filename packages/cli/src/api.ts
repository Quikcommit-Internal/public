import { getApiKey } from "./config.js";
import { DEFAULT_API_URL } from "@quikcommit/shared";
import type {
  CommitRequest,
  CommitRules,
  CommitGenerationHints,
  PRRequest,
  ChangelogRequest,
  ChangesetRequest,
  ChangesetResponse,
  BranchRequest,
  BranchResponse,
} from "@quikcommit/shared";

export interface ApiClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class ApiClient {
  private apiKey: string | null;
  private baseUrl: string;

  constructor(options: ApiClientOptions = {}) {
    this.apiKey = options.apiKey ?? getApiKey();
    this.baseUrl = options.baseUrl ?? process.env.QC_API_URL ?? DEFAULT_API_URL;
  }

  hasAuth(): boolean {
    return !!this.apiKey?.trim();
  }

  private async request<T>(
    endpoint: string,
    body: unknown,
    planRequiredMsg?: string
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error("Not authenticated. Run `qc login` first.");
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 413) {
        const errBody = await res.json().catch(() => ({})) as { error?: string; received_bytes?: number; limit_bytes?: number };
        const sizeHint = errBody.received_bytes
          ? ` (${Math.round(errBody.received_bytes / 1024)}KB > ${Math.round((errBody.limit_bytes ?? 0) / 1024)}KB limit)`
          : "";
        throw new Error(
          `Diff too large to send${sizeHint}. ` +
          `Try: qc --exclude '*.lock' --exclude 'dist/**' (or commit fewer files at a time).`
        );
      }
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string; code?: string };
      if (planRequiredMsg && err.code === "PLAN_REQUIRED") {
        throw new Error(planRequiredMsg);
      }
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  async generateCommit(
    diff: string,
    changes: string,
    rules?: CommitRules,
    model?: string,
    recentCommits?: string[],
    generationHints?: CommitGenerationHints
  ): Promise<{ message: string; diagnostics?: unknown }> {
    const body: CommitRequest = {
      diff,
      changes,
      rules,
      model,
      recent_commits: recentCommits,
      ...(generationHints && Object.keys(generationHints).length > 0
        ? { generation_hints: generationHints }
        : {}),
    };
    const data = await this.request<{ message?: string; diagnostics?: unknown }>(
      "/v1/commit",
      body
    );
    return { message: data.message ?? "", diagnostics: data.diagnostics };
  }

  async generatePR(req: PRRequest, model?: string): Promise<{ message: string; title: string }> {
    const data = await this.request<{ message?: string; title?: string }>(
      "/v1/pr",
      { ...req, model },
      "PR descriptions require Pro plan. Upgrade at https://app.quikcommit.dev/billing"
    );
    return { message: data.message ?? "", title: data.title ?? "" };
  }

  async generateChangelog(req: ChangelogRequest, model?: string): Promise<{ message: string }> {
    const data = await this.request<{ message?: string }>(
      "/v1/changelog",
      { ...req, model },
      "Changelog generation requires Pro plan. Upgrade at https://app.quikcommit.dev/billing"
    );
    return { message: data.message ?? "" };
  }

  async generateChangeset(req: ChangesetRequest): Promise<ChangesetResponse> {
    const data = await this.request<{
      packages?: ChangesetResponse["packages"];
      summary?: string;
    }>("/v1/changeset", req);
    return {
      packages: data.packages ?? [],
      summary: data.summary ?? "",
    };
  }

  async generateBranchName(req: BranchRequest): Promise<BranchResponse> {
    return this.request<BranchResponse>("/v1/branch", req);
  }

  private async fetchJson<T>(
    endpoint: string,
    options?: { method?: string; body?: string }
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error("Not authenticated. Run `qc login` first.");
    }
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: options?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: options?.body,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async getTeam(): Promise<{
    id: string;
    name: string;
    members: Array<{ id: string; email: string; name: string | null; role: string }>;
    member_count: number;
    plan: string;
  }> {
    return this.fetchJson("/v1/team");
  }

  async getTeamRules(): Promise<CommitRules> {
    return this.fetchJson<CommitRules>("/v1/team/rules");
  }

  async pushTeamRules(rules: CommitRules): Promise<void> {
    await this.fetchJson("/v1/team/rules", {
      method: "PUT",
      body: JSON.stringify(rules),
    });
  }

  async inviteTeamMember(email: string): Promise<void> {
    await this.fetchJson("/v1/team/invite", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async getUsage(): Promise<{ plan: string; commit_count: number; limit: number; remaining: number } | null> {
    if (!this.apiKey) return null;

    const res = await fetch(`${this.baseUrl}/v1/usage`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      plan?: string;
      commit_count?: number;
      limit?: number;
      remaining?: number;
    };
    return {
      plan: data.plan ?? "free",
      commit_count: data.commit_count ?? 0,
      limit: data.limit ?? 50,
      remaining: data.remaining ?? 50,
    };
  }
}
