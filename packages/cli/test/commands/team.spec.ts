import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetTeam = vi.fn();
const mockGetTeamRules = vi.fn();
const mockPushTeamRules = vi.fn();
const mockInviteTeamMember = vi.fn();

vi.mock("../../src/api.js", () => ({
  ApiClient: class {
    getTeam = mockGetTeam;
    getTeamRules = mockGetTeamRules;
    pushTeamRules = mockPushTeamRules;
    inviteTeamMember = mockInviteTeamMember;
  },
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  getConfig: vi.fn(() => ({})),
}));

import { existsSync, readFileSync } from "fs";
import { getConfig } from "../../src/config.js";
import { team } from "../../src/commands/team.js";

const teamInfo = {
  id: "team-1",
  name: "Acme",
  plan: "pro",
  member_count: 2,
  members: [
    { id: "u1", email: "alice@example.com", name: "Alice", role: "owner" },
    { id: "u2", email: "bob@example.com", name: null, role: "member" },
  ],
};

describe("team command", () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as typeof process.exit);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(getConfig).mockReturnValue({});
    mockGetTeam.mockResolvedValue(teamInfo);
    mockGetTeamRules.mockResolvedValue({ types: ["feat", "fix"], headerMaxLength: 72 });
    mockPushTeamRules.mockResolvedValue(undefined);
    mockInviteTeamMember.mockResolvedValue(undefined);
  });

  describe("team info", () => {
    it("prints team details for info subcommand", async () => {
      await team("info");

      expect(mockGetTeam).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith("\n  Team: Acme");
      expect(consoleLogSpy).toHaveBeenCalledWith("  Plan: pro");
      expect(consoleLogSpy).toHaveBeenCalledWith("  Members: 2");
      expect(consoleLogSpy).toHaveBeenCalledWith("    Alice <alice@example.com> (owner)");
      expect(consoleLogSpy).toHaveBeenCalledWith("    bob@example.com <bob@example.com> (member)");
    });

    it("defaults to info when no subcommand is provided", async () => {
      await team();

      expect(mockGetTeam).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith("\n  Team: Acme");
    });

    it("propagates not-authenticated errors from ApiClient", async () => {
      mockGetTeam.mockRejectedValue(new Error("Not authenticated. Run `qc login` first."));

      await expect(team("info")).rejects.toThrow("Not authenticated. Run `qc login` first.");
    });
  });

  describe("team rules", () => {
    it("pulls and prints team rules", async () => {
      await team("rules");

      expect(mockGetTeamRules).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith("\n  Team Commit Rules:");
      expect(consoleLogSpy).toHaveBeenCalledWith(
        JSON.stringify({ types: ["feat", "fix"], headerMaxLength: 72 }, null, 2)
      );
    });

    it("pushes local commitlint rules", async () => {
      vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith(".commitlintrc.json"));
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          rules: {
            "type-enum": [2, "always", ["feat", "fix", "chore"]],
            "header-max-length": [2, "always", 80],
          },
        })
      );

      await team("rules", ["push"]);

      expect(mockPushTeamRules).toHaveBeenCalledWith({
        types: ["feat", "fix", "chore"],
        headerMaxLength: 80,
      });
      expect(consoleLogSpy).toHaveBeenCalledWith("Team rules updated from local commitlint config.");
    });

    it("exits when rules push finds no local config", async () => {
      await expect(team("rules", ["push"])).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith("No local commitlint config found.");
      expect(mockPushTeamRules).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("propagates not-authenticated errors when pulling rules", async () => {
      mockGetTeamRules.mockRejectedValue(new Error("Not authenticated. Run `qc login` first."));

      await expect(team("rules")).rejects.toThrow("Not authenticated. Run `qc login` first.");
    });
  });

  describe("team invite", () => {
    it("sends an invitation for the given email", async () => {
      await team("invite", ["dev@example.com"]);

      expect(mockInviteTeamMember).toHaveBeenCalledWith("dev@example.com");
      expect(consoleLogSpy).toHaveBeenCalledWith("Invitation sent to dev@example.com");
    });

    it("exits when invite email is missing", async () => {
      await expect(team("invite")).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith("Usage: qc team invite <email>");
      expect(mockInviteTeamMember).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("propagates not-authenticated errors when inviting", async () => {
      mockInviteTeamMember.mockRejectedValue(new Error("Not authenticated. Run `qc login` first."));

      await expect(team("invite", ["dev@example.com"])).rejects.toThrow(
        "Not authenticated. Run `qc login` first."
      );
    });
  });

  describe("unknown subcommand", () => {
    it("prints usage and exits", async () => {
      await expect(team("unknown")).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith("Unknown team command: unknown");
      expect(consoleLogSpy).toHaveBeenCalledWith("Usage: qc team [info|rules|rules push|invite <email>]");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
