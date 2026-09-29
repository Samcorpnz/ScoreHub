import { SaturnFramer, applySaturnMessage } from "../protocol/saturnParser";
import { DEFAULT_MATCH_STATE, MatchState } from "../types";

const STX = 0x02;
const ETX = 0x03;

function buildFrame(type: string, data: number[]): Buffer {
  const typeBuf = type.split("").map(c => c.charCodeAt(0));
  const payload = [STX, ...typeBuf, ...data, ETX];
  let crc = 0;
  for (const b of payload) crc ^= b;
  return Buffer.from([...payload, crc]);
}

function freshState(): MatchState {
  return JSON.parse(JSON.stringify(DEFAULT_MATCH_STATE));
}

// 'D' base message data bytes (raw[2..25], 24 bytes)
const D_DATA = [
  0x31, 0x32, 0x3a, 0x33, 0x34, // clock "12:34" at raw[2..6]
  0x20,                           // space at raw[7]
  0x20, 0x34, 0x35,              // home score " 45" at raw[8..10]
  0x20, 0x36, 0x37,              // visitor score " 67" at raw[11..13]
  0x32,                           // home faults '2' at raw[14]
  0x31,                           // visitor faults '1' at raw[15]
  0x31,                           // home timeouts '1' at raw[16]
  0x32,                           // visitor timeouts '2' at raw[17]
  0x32,                           // period '2' at raw[18]
  0x31,                           // possession = home at raw[19]
  0x31,                           // running at raw[20]
  0x30,                           // horn off at raw[21]
  0x30, 0x30,                    // timeout active at raw[22..23]
  0x30, 0x30,                    // ball possession at raw[24..25]
];

// ─── SaturnFramer ────────────────────────────────────────────────────────────

describe("SaturnFramer", () => {
  it("extracts a single valid frame", () => {
    const framer = new SaturnFramer();
    const msgs = framer.feed(buildFrame("D", D_DATA));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("D");
  });

  it("extracts two consecutive frames from one buffer", () => {
    const framer = new SaturnFramer();
    const frame = buildFrame("D", D_DATA);
    const msgs = framer.feed(Buffer.concat([frame, frame]));
    expect(msgs).toHaveLength(2);
  });

  it("handles a frame split across two feed() calls", () => {
    const framer = new SaturnFramer();
    const frame = buildFrame("D", D_DATA);
    const mid = Math.floor(frame.length / 2);
    const first = framer.feed(frame.slice(0, mid));
    const second = framer.feed(frame.slice(mid));
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
    expect(second[0].type).toBe("D");
  });

  it("discards a frame with an invalid CRC", () => {
    const framer = new SaturnFramer();
    const frame = buildFrame("D", D_DATA);
    frame[frame.length - 1] ^= 0xff; // corrupt CRC
    expect(framer.feed(frame)).toHaveLength(0);
  });

  it("ignores garbage bytes before STX", () => {
    const framer = new SaturnFramer();
    const garbage = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const msgs = framer.feed(Buffer.concat([garbage, buildFrame("D", D_DATA)]));
    expect(msgs).toHaveLength(1);
  });
});

// ─── applySaturnMessage — 'D' base ────────────────────────────────────────────

describe("applySaturnMessage 'D'", () => {
  let state: MatchState;

  beforeEach(() => { state = freshState(); });

  it("parses clock seconds", () => {
    const next = applySaturnMessage({ type: "D", raw: buildFrame("D", D_DATA) }, state);
    expect(next.clockSeconds).toBe(12 * 60 + 34); // 754
  });

  it("parses team scores", () => {
    const next = applySaturnMessage({ type: "D", raw: buildFrame("D", D_DATA) }, state);
    expect(next.home.score).toBe(45);
    expect(next.visitor.score).toBe(67);
  });

  it("parses team faults and timeouts", () => {
    const next = applySaturnMessage({ type: "D", raw: buildFrame("D", D_DATA) }, state);
    expect(next.home.faults).toBe(2);
    expect(next.visitor.faults).toBe(1);
    expect(next.home.timeouts).toBe(1);
    expect(next.visitor.timeouts).toBe(2);
  });

  it("parses period, possession, running state, and horn", () => {
    const next = applySaturnMessage({ type: "D", raw: buildFrame("D", D_DATA) }, state);
    expect(next.period).toBe("2");
    expect(next.possession).toBe("home");
    expect(next.isRunning).toBe(true);
    expect(next.hornActive).toBe(false);
  });

  it("parses horn active when horn code is 1", () => {
    const d = [...D_DATA];
    d[19] = 0x31; // horn = 1
    const next = applySaturnMessage({ type: "D", raw: buildFrame("D", d) }, state);
    expect(next.hornActive).toBe(true);
  });

  it("parses visitor possession", () => {
    const d = [...D_DATA];
    d[17] = 0x32; // possession = 2 (visitor)
    const next = applySaturnMessage({ type: "D", raw: buildFrame("D", d) }, state);
    expect(next.possession).toBe("visitor");
  });

  it("increments sequenceId", () => {
    const next = applySaturnMessage({ type: "D", raw: buildFrame("D", D_DATA) }, state);
    expect(next.sequenceId).toBe(state.sequenceId + 1);
  });
});

// ─── applySaturnMessage — 'F1'/'F2' shirt + faults ───────────────────────────

describe("applySaturnMessage 'F1' / 'F2'", () => {
  it("parses shirt number, onCourt flag, and faults for home team", () => {
    // Player 7, on court, 2 faults
    const data = [
      0x80, 0x07, 0x32, // onCourt | tens=0, units=7, faults='2'
    ];
    const state = freshState();
    const next = applySaturnMessage({ type: "F1", raw: buildFrame("F1", data) }, state);
    expect(next.home.players).toHaveLength(1);
    expect(next.home.players[0]).toMatchObject({ number: 7, onCourt: true, faults: 2 });
  });

  it("parses a two-digit shirt number", () => {
    // Player 23, not on court, 0 faults
    const data = [
      0x02, 0x03, 0x30, // not onCourt, tens=2, units=3, faults=0
    ];
    const state = freshState();
    const next = applySaturnMessage({ type: "F1", raw: buildFrame("F1", data) }, state);
    expect(next.home.players[0]).toMatchObject({ number: 23, onCourt: false, faults: 0 });
  });

  it("parses visitor team via F2", () => {
    const data = [0x80, 0x0a, 0x31]; // player 10, on court, 1 fault
    const state = freshState();
    const next = applySaturnMessage({ type: "F2", raw: buildFrame("F2", data) }, state);
    expect(next.home.players).toHaveLength(0);
    expect(next.visitor.players[0]).toMatchObject({ number: 10, onCourt: true, faults: 1 });
  });

  it("skips player entry where number is 0 and not on court", () => {
    const data = [0x00, 0x00, 0x30]; // shirtNumber=0, onCourt=false → skip
    const state = freshState();
    const next = applySaturnMessage({ type: "F1", raw: buildFrame("F1", data) }, state);
    expect(next.home.players).toHaveLength(0);
  });

  it("preserves existing player name from prior state", () => {
    const state: MatchState = {
      ...freshState(),
      home: {
        ...DEFAULT_MATCH_STATE.home,
        players: [{ number: 7, name: "Jordan", onCourt: false, faults: 0, points: 0 }],
      },
    };
    const data = [0x80, 0x07, 0x30]; // player 7, on court, 0 faults
    const next = applySaturnMessage({ type: "F1", raw: buildFrame("F1", data) }, state);
    expect(next.home.players[0].name).toBe("Jordan");
  });

  it("does not crash on a frame truncated before the first player's bytes (SA-9)", () => {
    const state = freshState();
    // STX + 'F' + '1' only — no data bytes at all, raw.length === 3
    const raw = Buffer.from([STX, "F".charCodeAt(0), "1".charCodeAt(0)]);
    const next = applySaturnMessage({ type: "F1", raw }, state);
    expect(next.home.players).toEqual([]);
  });

  it("does not crash when raw ends exactly one byte short of a full player entry (SA-9)", () => {
    const state = freshState();
    // base=3 needs raw[3..5]; give only raw[3..4] (2 of 3 bytes) — one short
    const raw = Buffer.from([STX, "F".charCodeAt(0), "1".charCodeAt(0), 0x80, 0x07]);
    const next = applySaturnMessage({ type: "F1", raw }, state);
    expect(next.home.players).toEqual([]);
  });
});

// ─── applySaturnMessage — 'F3'/'F4' individual points ────────────────────────

describe("applySaturnMessage 'F3' / 'F4'", () => {
  it("updates individual player points for home team", () => {
    const stateWithPlayer: MatchState = {
      ...freshState(),
      home: {
        ...DEFAULT_MATCH_STATE.home,
        players: [{ number: 7, name: "", onCourt: true, faults: 0, points: 0 }],
      },
    };
    // Player index 0: 15 points → tens='1'(0x31), units='5'(0x35)
    const data = [0x31, 0x35];
    const next = applySaturnMessage({ type: "F3", raw: buildFrame("F3", data) }, stateWithPlayer);
    expect(next.home.players[0].points).toBe(15);
  });

  it("updates visitor points via F4", () => {
    const stateWithPlayer: MatchState = {
      ...freshState(),
      visitor: {
        ...DEFAULT_MATCH_STATE.visitor,
        players: [{ number: 5, name: "", onCourt: true, faults: 0, points: 0 }],
      },
    };
    const data = [0x30, 0x38]; // 8 points
    const next = applySaturnMessage({ type: "F4", raw: buildFrame("F4", data) }, stateWithPlayer);
    expect(next.visitor.players[0].points).toBe(8);
  });

  it("does not crash and leaves points unchanged when raw is truncated before any player's bytes (SA-9)", () => {
    const stateWithPlayer: MatchState = {
      ...freshState(),
      home: {
        ...DEFAULT_MATCH_STATE.home,
        players: [{ number: 7, name: "", onCourt: true, faults: 0, points: 3 }],
      },
    };
    const raw = Buffer.from([STX, "F".charCodeAt(0), "3".charCodeAt(0)]); // no data bytes
    const next = applySaturnMessage({ type: "F3", raw }, stateWithPlayer);
    expect(next.home.players[0].points).toBe(3);
  });
});

describe("applySaturnMessage — non-numeric bytes never produce a negative number", () => {
  // The relay's stateUpdate schema rejects a negative score or points value for
  // the whole state, which freezes every display until the field is valid again.
  const withPlayer = (): MatchState => ({
    ...freshState(),
    home: { ...DEFAULT_MATCH_STATE.home, players: [{ number: 7, name: "", onCourt: true, faults: 0, points: 4 }] },
  });

  it("F3 treats a space-padded points field as 0, not a negative value", () => {
    const next = applySaturnMessage({ type: "F3", raw: buildFrame("F3", [0x20, 0x20]) }, withPlayer());
    expect(next.home.players[0].points).toBe(0);
  });

  it("F3 reads a right-aligned single digit (' 5') as 5", () => {
    const next = applySaturnMessage({ type: "F3", raw: buildFrame("F3", [0x20, 0x35]) }, withPlayer());
    expect(next.home.players[0].points).toBe(5);
  });

  it("F3 stays within 0-99 for arbitrary bytes", () => {
    for (const [a, b] of [[0x00, 0xff], [0x2d, 0x39], [0x7f, 0x80], [0x3a, 0x3a]]) {
      const next = applySaturnMessage({ type: "F3", raw: buildFrame("F3", [a, b]) }, withPlayer());
      expect(next.home.players[0].points).toBeGreaterThanOrEqual(0);
      expect(next.home.players[0].points).toBeLessThanOrEqual(99);
    }
  });

  it("D keeps the previous score when the score field is not a plain number ('-5 ')", () => {
    const start: MatchState = { ...freshState(), home: { ...DEFAULT_MATCH_STATE.home, score: 12 } };
    const data = [...D_DATA];
    data.splice(6, 3, 0x2d, 0x35, 0x20); // home score field raw[8..10] -> "-5 " (D_DATA is offset by 2)
    const next = applySaturnMessage({ type: "D", raw: buildFrame("D", data) }, start);
    expect(next.home.score).toBe(12);
  });

  it("D keeps the previous score for a field with trailing junk ('12x')", () => {
    const start: MatchState = { ...freshState(), home: { ...DEFAULT_MATCH_STATE.home, score: 30 } };
    const data = [...D_DATA];
    data.splice(6, 3, 0x31, 0x32, 0x78);
    const next = applySaturnMessage({ type: "D", raw: buildFrame("D", data) }, start);
    expect(next.home.score).toBe(30);
  });
});

// ─── applySaturnMessage — 'N' names ──────────────────────────────────────────

describe("applySaturnMessage 'N'", () => {
  it("parses home and visitor team names", () => {
    const home12    = Array.from("Warriors    ").map(c => c.charCodeAt(0));
    const visitor12 = Array.from("Knights     ").map(c => c.charCodeAt(0));
    const data = [...home12, ...visitor12];
    const state = freshState();
    const next = applySaturnMessage({ type: "N", raw: buildFrame("N", data) }, state);
    expect(next.home.name).toBe("Warriors");
    expect(next.visitor.name).toBe("Knights");
  });

  it("keeps existing name if name field is blank", () => {
    const blank12 = Array(12).fill(0x20);
    const visitor12 = Array.from("Knights     ").map(c => c.charCodeAt(0));
    const data = [...blank12, ...visitor12];
    const state = freshState();
    const next = applySaturnMessage({ type: "N", raw: buildFrame("N", data) }, state);
    expect(next.home.name).toBe("Home"); // preserved from default
  });

  it("does not crash and keeps existing names when raw is far shorter than the name table (SA-9)", () => {
    const state: MatchState = {
      ...freshState(),
      home: {
        ...DEFAULT_MATCH_STATE.home,
        players: [{ number: 7, name: "Jordan", onCourt: true, faults: 0, points: 0 }],
      },
    };
    const raw = Buffer.from([STX, "N".charCodeAt(0), ETX, 0]); // no name bytes at all
    const next = applySaturnMessage({ type: "N", raw }, state);
    expect(next.home.name).toBe("Home");
    expect(next.visitor.name).toBe("Visitor");
    expect(next.home.players[0].name).toBe("Jordan"); // out-of-range player offset left untouched
  });
});

// ─── applySaturnMessage — 'T' datetime/sport ─────────────────────────────────

describe("applySaturnMessage 'T'", () => {
  it("parses the sport type", () => {
    // raw[19] = sport byte; raw[19] - 0x30 = sport code
    // sport code 1 → "volleyball"
    // data[17] = raw[19] (type 'T' is 1 byte, so data starts at raw[2])
    const data = [...Array(17).fill(0x30), 0x31, 0x30]; // 19 bytes, sport at index 17
    const state = freshState();
    const next = applySaturnMessage({ type: "T", raw: buildFrame("T", data) }, state);
    expect(next.sport).toBe("volleyball");
  });

  it("returns state unchanged if message is too short", () => {
    const data = Array(5).fill(0x30); // only 5 bytes of data, raw.length < 22
    const state = freshState();
    const next = applySaturnMessage({ type: "T", raw: buildFrame("T", data) }, state);
    expect(next).toBe(state); // same reference
  });
});

// ─── applySaturnMessage — edge cases ─────────────────────────────────────────

describe("applySaturnMessage edge cases", () => {
  it("returns state unchanged for an unknown message type", () => {
    const state = freshState();
    const next = applySaturnMessage({ type: "Z", raw: Buffer.from([STX, 0x5a, ETX, 0]) }, state);
    expect(next).toBe(state);
  });

  it("does not crash on a truncated 'D' message and returns a valid state", () => {
    const state = freshState();
    const next = applySaturnMessage({ type: "D", raw: Buffer.alloc(0) }, state);
    expect(next).toHaveProperty("home");
    expect(next).toHaveProperty("visitor");
    expect(next).toHaveProperty("sequenceId");
  });
});
