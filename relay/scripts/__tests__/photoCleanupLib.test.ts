import { parseArgs, planCleanup, MIN_AGE_MS } from "../photoCleanupLib";

describe("parseArgs", () => {
  it("is a dry run by default", () => {
    expect(parseArgs([])).toEqual({ apply: false });
  });

  it.each([
    [["--apply"]],
    [["--apply", "--confirm-host", "db.example.com"]],
    [["--apply", "--confirm-bucket", "scorehub-uploads"]],
  ])("refuses %j without both confirmations", argv => {
    expect(() => parseArgs(argv)).toThrow(/--confirm-host .* --confirm-bucket/);
  });

  it("accepts --apply with both confirmations", () => {
    expect(parseArgs(["--apply", "--confirm-host", "db.example.com", "--confirm-bucket", "scorehub-uploads"]))
      .toEqual({ apply: true, confirmHost: "db.example.com", confirmBucket: "scorehub-uploads" });
  });

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--wat"])).toThrow(/unknown argument/);
  });
});

describe("planCleanup", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  const old = new Date(now.getTime() - MIN_AGE_MS - 1);
  const cdn = "https://cdn.example.com";
  const photo = (key: string, lastModified: Date | undefined = old) => ({ key, lastModified });

  it("keeps a photo its player points at, ignoring the cache-busting query", () => {
    const plan = planCleanup(
      [photo("player-photos/org1/p1.jpg")],
      [{ id: "p1", orgId: "org1", photoUrl: `${cdn}/player-photos/org1/p1.jpg?t=123` }],
      now,
    );
    expect(plan).toEqual({ orphaned: [], kept: 1, skippedRecent: 0, skippedUnrecognised: [] });
  });

  it.each([
    ["/player-photos/org1/p1.jpg?t=1"],
    [`${cdn}/player-photos/org1/p1.jpg#frag`],
    [`${cdn}/player-photos/org1/p1%2Ejpg`],
    [`${cdn}/assets/../player-photos/org1/p1.jpg`],
  ])("keeps a photo referenced as %s", photoUrl => {
    const plan = planCleanup([photo("player-photos/org1/p1.jpg")], [{ id: "p1", orgId: "org1", photoUrl }], now);
    expect(plan.orphaned).toEqual([]);
    expect(plan.kept).toBe(1);
  });

  it("flags photos whose player was removed, moved org, has no photo, or uses another file", () => {
    const plan = planCleanup(
      [
        photo("player-photos/org1/gone.png"),
        photo("player-photos/org1/p2.png"),
        photo("player-photos/org1/p3.png"),
        photo("player-photos/org1/p4.png"),
        photo("player-photos/org1/p4.jpg"),
      ],
      [
        { id: "p2", orgId: "org2", photoUrl: `${cdn}/player-photos/org2/p2.png` },
        { id: "p3", orgId: "org1", photoUrl: null },
        { id: "p4", orgId: "org1", photoUrl: `${cdn}/player-photos/org1/p4.jpg?t=1` },
      ],
      now,
    );
    expect(plan.kept).toBe(1);
    expect(plan.orphaned).toEqual([
      { key: "player-photos/org1/gone.png", reason: "player no longer exists" },
      { key: "player-photos/org1/p2.png", reason: "player belongs to another org" },
      { key: "player-photos/org1/p3.png", reason: "player has no photo set" },
      { key: "player-photos/org1/p4.png", reason: "player's photo is a different file" },
    ]);
  });

  it("does not match a key that is only a suffix of another player's url", () => {
    const plan = planCleanup(
      [photo("player-photos/org1/p1.jpg")],
      [{ id: "p1", orgId: "org1", photoUrl: `${cdn}/player-photos/org1/xp1.jpg` }],
      now,
    );
    expect(plan.orphaned).toHaveLength(1);
  });

  it("leaves recent and undated uploads alone", () => {
    const plan = planCleanup(
      [photo("player-photos/org1/new.png", new Date(now.getTime() - 1000)), { key: "player-photos/org1/undated.png" }],
      [],
      now,
    );
    expect(plan.orphaned).toEqual([]);
    expect(plan.skippedRecent).toBe(2);
  });

  it("never deletes keys it does not recognise", () => {
    const keys = ["player-photos/readme.txt", "player-photos/org1/nested/p1.png", "logos/org1/home.png"];
    const plan = planCleanup(keys.map(k => photo(k)), [], now);
    expect(plan.orphaned).toEqual([]);
    expect(plan.skippedUnrecognised).toEqual(keys);
  });
});
