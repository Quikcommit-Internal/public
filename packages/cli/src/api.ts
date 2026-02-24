import { getApiKey } from "./config.js";
import { DEFAULT_API_URL } from "@quikcommit/shared";
import type {
  CommitRequest,
  CommitRules,
  PRRequest,
  ChangelogRequest,
  ChangesetRequest,
  ChangesetResponse,
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
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const code = (err as { code?: string }).code;
      if (planRequiredMsg && code === "PLAN_REQUIRED") {
        throw new Error(planRequiredMsg);
      }
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  async generateCommit(
    diff: string,
    changes: string,
    rules?: CommitRules,
    model?: string
  ): Promise<{ message: string; diagnostics?: unknown }> {
    const body: CommitRequest = { diff, changes, rules, model };
    const data = await this.request<{ message?: string; diagnostics?: unknown }>(
      "/v1/commit",
      body
    );
    return { message: data.message ?? "", diagnostics: data.diagnostics };
  }

  async generatePR(req: PRRequest, model?: string): Promise<{ message: string }> {
    const data = await this.request<{ message?: string }>(
      "/v1/pr",
      { ...req, model },
      "PR descriptions require Pro plan. Upgrade at https://app.quikcommit.dev/billing"
    );
    return { message: data.message ?? "" };
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
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
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
