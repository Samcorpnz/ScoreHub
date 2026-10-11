import { regulationClock, periodClock } from "../periodClock";

// The relay's copy of the frontend's period-length rules (sport-templates.ts):
// what /action/period/end and Reset Match put on the clock.

describe("regulationClock", () => {
  it("is the sport's period length", () => {
    expect(regulationClock({ sport: "netball" })).toBe(900);
    expect(regulationClock({ sport: "basketball" })).toBe(600);
    expect(regulationClock({ sport: "football" })).toBe(0);
  });

  it("is 6:00 for a Fast5 netball match", () => {
    expect(regulationClock({ sport: "netball", sportConfig: { format: "fast5" } })).toBe(360);
    expect(regulationClock({ sport: "netball", sportConfig: { format: "standard" } })).toBe(900);
    // the format only means something for netball
    expect(regulationClock({ sport: "basketball", sportConfig: { format: "fast5" } })).toBe(600);
  });
});

describe("periodClock", () => {
  it("is a regulation period up to the sport's last one", () => {
    expect(periodClock({ sport: "netball" }, 4)).toBe(900);
    expect(periodClock({ sport: "netball", sportConfig: { format: "fast5" } }, 4)).toBe(360);
  });

  it("gives extra time the sport's own length", () => {
    expect(periodClock({ sport: "netball" }, 5)).toBe(420);
    expect(periodClock({ sport: "netball" }, 6)).toBe(420);
    expect(periodClock({ sport: "netball", sportConfig: { format: "fast5" } }, 5)).toBe(60);
    expect(periodClock({ sport: "basketball" }, 5)).toBe(300);
  });

  it.each([
    ["handball", 3, 300], ["futsal", 3, 300], ["floorball", 4, 600],
    ["hockey", 5, 450], ["waterpolo", 5, 180], ["touch_rugby", 3, 120],
  ])("gives %s extra time its own length", (sport, period, seconds) => {
    expect(periodClock({ sport: sport as never }, period)).toBe(seconds);
  });

  it("leaves count-up sports on zero", () => {
    expect(periodClock({ sport: "football" }, 3)).toBe(0);
    expect(periodClock({ sport: "rugby_league" }, 3)).toBe(0);
  });

  it("prefers the length the operator set for the match", () => {
    expect(periodClock({ sport: "netball", sportConfig: { extraTimeSeconds: 300 } }, 5)).toBe(300);
    expect(periodClock({ sport: "netball", sportConfig: { format: "fast5", extraTimeSeconds: 120 } }, 5)).toBe(120);
    expect(periodClock({ sport: "basketball", sportConfig: { extraTimeSeconds: 180 } }, 6)).toBe(180);
    // but never during regulation, and never a malformed value
    expect(periodClock({ sport: "netball", sportConfig: { extraTimeSeconds: 300 } }, 4)).toBe(900);
    expect(periodClock({ sport: "netball", sportConfig: { extraTimeSeconds: "300" } }, 5)).toBe(420);
  });

  it("has no extra time for set sports or custom matches", () => {
    expect(periodClock({ sport: "volleyball", sportConfig: { extraTimeSeconds: 300 } }, 9)).toBe(0);
    expect(periodClock({ sport: "custom" }, 9)).toBe(600);
  });
});
