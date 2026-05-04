import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/index.js";

describe("parseArgs", () => {
  describe("short flags", () => {
    it("parses -p as push", () => {
      const result = parseArgs(["-p"]);
      expect(result.push).toBe(true);
    });

    it("parses -a as all", () => {
      const result = parseArgs(["-a"]);
      expect(result.all).toBe(true);
    });

    it("parses -m as messageOnly", () => {
      const result = parseArgs(["-m"]);
      expect(result.messageOnly).toBe(true);
    });

    it("parses -v as verbose", () => {
      const result = parseArgs(["-v"]);
      expect(result.verbose).toBe(true);
    });

    it("parses -q as quiet", () => {
      const result = parseArgs(["-q"]);
      expect(result.quiet).toBe(true);
    });

    it("parses -n as dryRun", () => {
      const result = parseArgs(["-n"]);
      expect(result.dryRun).toBe(true);
    });

    it("parses -i as interactive", () => {
      const result = parseArgs(["-i"]);
      expect(result.interactive).toBe(true);
    });

    it("parses -s as split", () => {
      const result = parseArgs(["-s"]);
      expect(result.split).toBe(true);
    });

    it("parses -l as local", () => {
      const result = parseArgs(["-l"]);
      expect(result.local).toBe(true);
    });

    it("parses -b as body", () => {
      const result = parseArgs(["-b"]);
      expect(result.forceBody).toBe(true);
    });

    it("parses -c as confirm", () => {
      const result = parseArgs(["-c"]);
      expect(result.confirm).toBe(true);
    });

    it("parses -t with value as type", () => {
      const result = parseArgs(["-t", "fix"]);
      expect(result.type).toBe("fix");
    });

    it("parses -S with value as scope", () => {
      const result = parseArgs(["-S", "auth"]);
      expect(result.scope).toBe("auth");
    });

    it("parses -e with value as exclude", () => {
      const result = parseArgs(["-e", "*.lock"]);
      expect(result.exclude).toContain("*.lock");
    });
  });

  describe("composed short flags", () => {
    it("parses -ap as all + push", () => {
      const result = parseArgs(["-ap"]);
      expect(result.all).toBe(true);
      expect(result.push).toBe(true);
    });

    it("parses -apv as all + push + verbose", () => {
      const result = parseArgs(["-apv"]);
      expect(result.all).toBe(true);
      expect(result.push).toBe(true);
      expect(result.verbose).toBe(true);
    });

    it("parses -ape with value *.lock (composed flag value-taking at end)", () => {
      const result = parseArgs(["-ape", "*.lock"]);
      expect(result.all).toBe(true);
      expect(result.push).toBe(true);
      expect(result.exclude).toContain("*.lock");
    });
  });

  describe("short-flag value guard consistency", () => {
    it("single -e accepts bare '-' as a value (stdin convention)", () => {
      const result = parseArgs(["-e", "-"]);
      expect(result.exclude).toContain("-");
    });

    it("composed -e accepts bare '-' as a value (same behavior as single)", () => {
      const result = parseArgs(["-ae", "-"]);
      expect(result.all).toBe(true);
      expect(result.exclude).toContain("-");
    });

    it("single -e rejects a value that starts with '-' and has length > 1", () => {
      expect(() => parseArgs(["-e", "--bad"])).toThrow("Flag -e requires a value");
    });

    it("composed -e rejects a value that starts with '-' and has length > 1", () => {
      expect(() => parseArgs(["-ae", "--bad"])).toThrow("Flag -e requires a value");
    });
  });

  describe("flag conflicts", () => {
    it("throws when -m and -p are combined", () => {
      expect(() => parseArgs(["-m", "-p"])).toThrow(
        "Cannot combine --message-only (-m) with --push (-p)"
      );
    });

    it("throws when -m and -p are composed", () => {
      expect(() => parseArgs(["-mp"])).toThrow(
        "Cannot combine --message-only (-m) with --push (-p)"
      );
    });

    it("throws when -q and -v are combined", () => {
      expect(() => parseArgs(["-q", "-v"])).toThrow(
        "Cannot combine --quiet (-q) with --verbose (-v)"
      );
    });

    it("throws when --dry-run and --push are combined", () => {
      expect(() => parseArgs(["--dry-run", "--push"])).toThrow(
        "Cannot combine --dry-run (-n) with --push (-p). Pick one."
      );
    });

    it("throws when -n and -p are combined", () => {
      expect(() => parseArgs(["-n", "-p"])).toThrow(
        "Cannot combine --dry-run (-n) with --push (-p). Pick one."
      );
    });

    it("throws when -np is composed", () => {
      expect(() => parseArgs(["-np"])).toThrow(
        "Cannot combine --dry-run (-n) with --push (-p). Pick one."
      );
    });
  });

  describe("long flags still work", () => {
    it("parses --push", () => {
      const result = parseArgs(["--push"]);
      expect(result.push).toBe(true);
    });

    it("parses --all", () => {
      const result = parseArgs(["--all"]);
      expect(result.all).toBe(true);
    });

    it("parses --verbose", () => {
      const result = parseArgs(["--verbose"]);
      expect(result.verbose).toBe(true);
    });

    it("parses --dry-run", () => {
      const result = parseArgs(["--dry-run"]);
      expect(result.dryRun).toBe(true);
    });

    it("parses --no-context", () => {
      const result = parseArgs(["--no-context"]);
      expect(result.noContext).toBe(true);
    });

    it("parses --no-smart-diff", () => {
      const result = parseArgs(["--no-smart-diff"]);
      expect(result.noSmartDiff).toBe(true);
    });
  });

  describe("subcommands", () => {
    it("parses pr command", () => {
      const result = parseArgs(["pr"]);
      expect(result.command).toBe("pr");
    });

    it("parses changelog command", () => {
      const result = parseArgs(["changelog"]);
      expect(result.command).toBe("changelog");
    });

    it("flags work with subcommands", () => {
      const result = parseArgs(["pr", "--create", "--base", "develop"]);
      expect(result.command).toBe("pr");
      expect(result.create).toBe(true);
      expect(result.base).toBe("develop");
    });
  });

  describe("positionals", () => {
    it("team subcommand with positionals after it", () => {
      const result = parseArgs(["team", "rules", "push"]);
      expect(result.command).toBe("team");
      expect(result.positionals).toEqual(["rules", "push"]);
    });

    it("team subcommand: --model value that equals 'team' is not in positionals", () => {
      const result = parseArgs(["team", "rules", "--model", "team"]);
      expect(result.command).toBe("team");
      expect(result.positionals).toEqual(["rules"]);
      expect(result.model).toBe("team");
    });

    it("positionals is empty when no subcommand", () => {
      const result = parseArgs(["-ap"]);
      expect(result.positionals).toEqual([]);
    });

    it("positionals is empty when subcommand has no trailing positionals", () => {
      const result = parseArgs(["team"]);
      expect(result.positionals).toEqual([]);
    });
  });
});
