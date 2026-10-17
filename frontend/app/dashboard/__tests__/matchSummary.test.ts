import { describe, it, expect } from "vitest";
import { summariseMatch, type LiveSummary } from "../matchSummary";

const live = (overrides: Partial<LiveSummary> = {}): LiveSummary => ({
  homeScore: 0, visitorScore: 0, period: "1", periodBreak: false, isRunning: false,
  clockSeconds: 900, countDown: true, ...overrides,
});

describe("summariseMatch", () => {
  it("shows an upcoming fixture as scheduled, with no score", () => {
    expect(summariseMatch("SCHEDULED", "netball", null)).toEqual({ status: "Scheduled", tone: "idle" });
  });

  it("shows a live match that hasn't begun as not started", () => {
    expect(summariseMatch("LIVE", "netball", live())).toEqual({ status: "Not started", tone: "idle" });
  });

  it("shows the score and period while the clock runs", () => {
    expect(summariseMatch("LIVE", "netball", live({ period: "2", isRunning: true, clockSeconds: 412, homeScore: 14, visitorScore: 11 })))
      .toEqual({ status: "In play", tone: "live", score: "14 – 11", period: "QTR 2" });
  });

  it("shows a stopped clock mid-match as paused", () => {
    expect(summariseMatch("LIVE", "rugby_union", live({ clockSeconds: 1234, countDown: false, homeScore: 7 })))
      .toEqual({ status: "Paused", tone: "idle", score: "7 – 0", period: "HALF 1" });
  });

  it("names the break", () => {
    expect(summariseMatch("LIVE", "rugby_union", live({ period: "2", periodBreak: true, countDown: false, clockSeconds: 0 })))
      .toMatchObject({ status: "Half time", tone: "break" });
  });

  it("shows full time after the last period", () => {
    expect(summariseMatch("LIVE", "football", live({ period: "3", periodBreak: true, homeScore: 2, visitorScore: 1 })))
      .toEqual({ status: "Full time", tone: "break", score: "2 – 1" });
  });

  it("shows an extra-time period by its own name", () => {
    expect(summariseMatch("LIVE", "netball", live({ period: "5", isRunning: true, clockSeconds: 300 })))
      .toMatchObject({ period: "ET 1" });
  });

  it("shows a finished match as final with its score", () => {
    expect(summariseMatch("ENDED", "netball", live({ period: "5", periodBreak: true, homeScore: 52, visitorScore: 48 })))
      .toEqual({ status: "Final", tone: "done", score: "52 – 48" });
  });

  it("falls back to plain live for a row with no saved state", () => {
    expect(summariseMatch("LIVE", "netball", null)).toEqual({ status: "Live", tone: "live" });
  });
});
