import { parseArgs, percentile, evaluate, DEFAULTS, Summary } from "../lib";

describe("percentile", () => {
  it("uses nearest-rank on unsorted input", () => {
    const xs = [50, 10, 40, 20, 30];
    expect(percentile(xs, 50)).toBe(30);
    expect(percentile(xs, 100)).toBe(50);
    expect(percentile(xs, 1)).toBe(10);
  });

  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("returns NaN for an empty sample, never a passing 0", () => {
    expect(percentile([], 95)).toBeNaN();
  });

  it("handles a single sample", () => {
    expect(percentile([7], 99)).toBe(7);
  });

  it("p95 of 1..100 is 95", () => {
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
  });
});

describe("parseArgs", () => {
  it("returns defaults with no arguments, without sharing the defaults object", () => {
    const cfg = parseArgs([]);
    expect(cfg).toEqual(DEFAULTS);
    cfg.thresholds.p95LatencyMs = 1;
    expect(DEFAULTS.thresholds.p95LatencyMs).toBe(500);
  });

  it("parses every flag", () => {
    const cfg = parseArgs([
      "--url", "https://relay.example.com/", "--matches", "100", "--viewers", "25", "--duration", "60",
      "--rate", "2", "--ramp", "10", "--mode", "multi", "--keep-data", "--json", "out.json",
      "--p95", "250", "--p99", "900", "--min-connect", "0.99", "--max-diverged", "2",
    ]);
    expect(cfg).toMatchObject({
      url: "https://relay.example.com", matches: 100, viewersPerMatch: 25, durationSec: 60,
      scoreRateHz: 2, rampPerSec: 10, mode: "multi", keepData: true, jsonOut: "out.json",
      thresholds: { p95LatencyMs: 250, p99LatencyMs: 900, minConnectSuccess: 0.99, maxDivergedViewers: 2 },
    });
  });

  it.each([
    [["--matches", "0"], /--matches must be >= 1/],
    [["--matches", "1.5"], /must be an integer/],
    [["--matches", "abc"], /needs a number/],
    [["--matches"], /needs a number/],
    [["--viewers", "-1"], /must be >= 0/],
    [["--min-connect", "2"], /must be <= 1/],
    [["--mode", "chaos"], /--mode must be/],
    [["--bogus"], /unknown argument/],
  ])("rejects %j", (argv, msg) => {
    expect(() => parseArgs(argv as string[])).toThrow(msg);
  });

  it("forces a single match in legacy mode when none is asked for", () => {
    expect(parseArgs(["--mode", "legacy"]).matches).toBe(1);
  });

  it("refuses to pretend legacy mode can run several matches", () => {
    expect(() => parseArgs(["--mode", "legacy", "--matches", "5"])).toThrow(/exactly 1 match/);
  });
});

const healthy: Summary = {
  socketsAttempted: 100, socketsConnected: 100, unexpectedDisconnects: 0,
  latencyMs: [10, 20, 30, 40, 50], viewersChecked: 90, viewersDiverged: 0,
  controllersDenied: 0, actionsSent: 500, sequenceRegressions: 0,
};

describe("evaluate", () => {
  const t = DEFAULTS.thresholds;

  it("passes a healthy run", () => {
    expect(evaluate(healthy, t)).toEqual({ pass: true, failures: [] });
  });

  it("fails on low connect success", () => {
    const v = evaluate({ ...healthy, socketsConnected: 90 }, t);
    expect(v.pass).toBe(false);
    expect(v.failures[0]).toMatch(/connect success 90\.00%/);
  });

  it("fails when p95 or p99 exceed their limits", () => {
    const slow = { ...healthy, latencyMs: Array.from({ length: 100 }, () => 800) };
    const v = evaluate(slow, t);
    expect(v.failures.join("|")).toMatch(/p95 latency 800ms > 500ms/);
    expect(v.failures.join("|")).not.toMatch(/p99/);
    const veryslow = { ...healthy, latencyMs: Array.from({ length: 100 }, () => 2000) };
    expect(evaluate(veryslow, t).failures.join("|")).toMatch(/p99 latency 2000ms/);
  });

  it("fails on any diverged viewer by default (a dropped update)", () => {
    const v = evaluate({ ...healthy, viewersDiverged: 1 }, t);
    expect(v.pass).toBe(false);
    expect(v.failures[0]).toMatch(/1 viewer\(s\) ended on a different score/);
  });

  it("tolerates diverged viewers up to the configured max", () => {
    expect(evaluate({ ...healthy, viewersDiverged: 2 }, { ...t, maxDivergedViewers: 2 }).pass).toBe(true);
  });

  it("fails when a controller was never granted control or a socket dropped", () => {
    expect(evaluate({ ...healthy, controllersDenied: 1 }, t).pass).toBe(false);
    expect(evaluate({ ...healthy, unexpectedDisconnects: 3 }, t).failures[0]).toMatch(/3 socket/);
  });

  it("fails when viewers saw sequenceIds go backwards", () => {
    const v = evaluate({ ...healthy, sequenceRegressions: 4 }, t);
    expect(v.pass).toBe(false);
    expect(v.failures[0]).toMatch(/4 out-of-order sequenceId/);
  });

  it("fails (rather than passing vacuously) when nothing was measured", () => {
    expect(evaluate({ ...healthy, actionsSent: 0 }, t).pass).toBe(false);
    expect(evaluate({ ...healthy, latencyMs: [] }, t).failures.join("|")).toMatch(/0 latency samples/);
  });

  it("does not demand latency samples when there are no viewers", () => {
    expect(evaluate({ ...healthy, viewersChecked: 0, latencyMs: [] }, t).pass).toBe(true);
  });

  it("reports every failure, not just the first", () => {
    const v = evaluate({ ...healthy, socketsConnected: 50, viewersDiverged: 5, controllersDenied: 2 }, t);
    expect(v.failures.length).toBeGreaterThanOrEqual(3);
  });

  it("treats zero attempted sockets as a failed connect rate", () => {
    expect(evaluate({ ...healthy, socketsAttempted: 0, socketsConnected: 0 }, t).pass).toBe(false);
  });
});
