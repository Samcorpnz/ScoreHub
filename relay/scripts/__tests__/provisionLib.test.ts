import { parseArgs, describeDatabase, githubNames, hashToken, newToken, newDisplayToken } from "../provisionLib";

describe("parseArgs", () => {
  it("requires an explicit --env", () => {
    expect(() => parseArgs([])).toThrow(/--env prod\|uat\|local is required/);
  });

  it("is a dry run by default", () => {
    expect(parseArgs(["--env", "uat"])).toEqual({ env: "uat", apply: false, rotateToken: false });
  });

  it("refuses --apply without --confirm-host", () => {
    expect(() => parseArgs(["--env", "prod", "--apply"])).toThrow(/--confirm-host/);
  });

  it("accepts --apply with --confirm-host and --rotate-token", () => {
    expect(parseArgs(["--env", "prod", "--apply", "--confirm-host", "db.example.com", "--rotate-token"]))
      .toEqual({ env: "prod", apply: true, confirmHost: "db.example.com", rotateToken: true });
  });

  it.each([[["--env", "staging"]], [["--env", "uat", "--wat"]], [["--env"]]])("rejects %j", argv => {
    expect(() => parseArgs(argv)).toThrow();
  });
});

describe("describeDatabase", () => {
  it("returns host and database without credentials", () => {
    const d = describeDatabase("postgresql://user:hunter2@ep-cool-1234.ap-southeast-2.aws.neon.tech/scorehub?sslmode=require");
    expect(d).toEqual({ host: "ep-cool-1234.ap-southeast-2.aws.neon.tech", database: "scorehub" });
    expect(JSON.stringify(d)).not.toMatch(/hunter2|user/);
  });

  it("throws on missing or malformed URLs", () => {
    expect(() => describeDatabase(undefined)).toThrow(/not set/);
    expect(() => describeDatabase("not a url")).toThrow(/valid URL/);
  });
});

describe("githubNames", () => {
  it("uses bare SMOKE_* for prod/local and SMOKE_UAT_* for UAT", () => {
    expect(githubNames("prod").controlToken).toBe("SMOKE_CONTROL_TOKEN");
    expect(githubNames("uat")).toEqual({
      orgId: "SMOKE_UAT_ORG_ID", matchId: "SMOKE_UAT_MATCH_ID", displayToken: "SMOKE_UAT_DISPLAY_TOKEN", controlToken: "SMOKE_UAT_CONTROL_TOKEN",
    });
  });
});

describe("tokens", () => {
  it("mints 64-hex control tokens and 48-hex display tokens, uniquely", () => {
    expect(newToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(newDisplayToken()).toMatch(/^[0-9a-f]{48}$/);
    expect(newToken()).not.toBe(newToken());
  });

  it("hashes exactly as the relay does (sha256 hex)", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
