import { SaturnFramer, applySaturnMessage } from "../protocol/saturnParser";
import { DEFAULT_MATCH_STATE, MatchState } from "../types";
// The relay's own runtime validator for `stateUpdate`. Importing the real
// schema (not a copy) is the point: if the bridge ever emits a state the relay
// rejects, the relay drops it with only a console.warn and the scoreboard
// silently freezes on stale data — the failure this contract test exists for.
import { matchStateSchema } from "../../../relay/src/schemas";

const STX = 0x02;
const ETX = 0x03;

function buildFrame(type: string, data: number[]): Buffer {
  const payload = [STX, ...type.split("").map(c => c.charCodeAt(0)), ...data, ETX];
  let crc = 0;
  for (const b of payload) crc ^= b;
  return Buffer.from([...payload, crc]);
}

const ascii = (s: string) => s.split("").map(c => c.charCodeAt(0));
const pad = (s: string, n: number) => ascii(s.padEnd(n, " ").slice(0, n));

// A realistic Saturn cycle, byte-for-byte per the spec layout in saturnParser.ts.
const D = [
  ...ascii("12:34"), 0x20,
  ...ascii(" 45"), ...ascii(" 67"),
  0x32, 0x31, 0x31, 0x32, // faults h/v, timeouts h/v
  0x32, 0x31, 0x31, 0x30, // period, possession=home, running, horn off
  0x30, 0x30, 0x30, 0x30,
];
const F_SHIRTS = (n1: string, n2: string) => [0x20, 0x20, ...ascii(n1.padStart(2, "0")), 0x31, 0x30, ...ascii(n2.padStart(2, "0")), 0x30, 0x31];
const F_POINTS = [0x20, 0x20, ...ascii("12"), ...ascii("08")];
const N = [0x20, 0x20, ...pad("Sharks", 12), ...pad("Eagles", 12)];

const GOLDEN_CYCLE: Buffer[] = [
  buildFrame("D", D),
  buildFrame("F1", F_SHIRTS("7", "10")),
  buildFrame("F2", F_SHIRTS("4", "9")),
  buildFrame("F3", F_POINTS),
  buildFrame("F4", F_POINTS),
  buildFrame("T", ascii("  20260929 120000")),
  buildFrame("N", N),
];

// Deterministic PRNG so a fuzz failure is reproducible from its seed.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// What the relay actually receives: the state after a JSON round trip over the socket
// (so NaN/Infinity become null, undefined fields vanish).
const overTheWire = (s: MatchState): unknown => JSON.parse(JSON.stringify(s));

function expectRelayAccepts(state: MatchState, label: string) {
  const result = matchStateSchema.safeParse(overTheWire(state));
  if (!result.success) {
    throw new Error(`relay would reject bridge state (${label}): ${JSON.stringify(result.error.issues.slice(0, 3))}`);
  }
}

function freshState(): MatchState {
  return JSON.parse(JSON.stringify(DEFAULT_MATCH_STATE));
}

describe("bridge -> relay contract (stateUpdate)", () => {
  it("the bridge's default state is accepted by the relay's schema", () => {
    expectRelayAccepts(freshState(), "DEFAULT_MATCH_STATE");
  });

  it("every intermediate state of a full Saturn cycle is accepted (the bridge broadcasts mid-cycle)", () => {
    const framer = new SaturnFramer();
    let state = freshState();
    for (const frame of GOLDEN_CYCLE) {
      for (const msg of framer.feed(frame)) {
        state = applySaturnMessage(msg, state);
        expectRelayAccepts(state, `after '${msg.type}'`);
      }
    }
  });

  it("a full cycle produces the expected scoreboard the relay would store", () => {
    const framer = new SaturnFramer();
    let state = freshState();
    for (const frame of GOLDEN_CYCLE) for (const msg of framer.feed(frame)) state = applySaturnMessage(msg, state);

    expect(state.home.score).toBe(45);
    expect(state.visitor.score).toBe(67);
    expect(state.home.name).toBe("Sharks");
    expect(state.visitor.name).toBe("Eagles");
    expect(state.period).toBe("2");
    expect(state.isRunning).toBe(true);
    expect(state.sequenceId).toBeGreaterThan(0);
  });

  it("is unaffected by how the serial stream is chunked (1 byte at a time, and random splits)", () => {
    const stream = Buffer.concat(GOLDEN_CYCLE);
    const run = (chunks: Buffer[]) => {
      const framer = new SaturnFramer();
      let state = freshState();
      for (const c of chunks) for (const msg of framer.feed(c)) state = applySaturnMessage(msg, state);
      return state;
    };

    const whole = run([stream]);
    const bytewise = run(Array.from(stream, b => Buffer.from([b])));
    expect(bytewise).toEqual(whole);

    const rand = mulberry32(42);
    for (let trial = 0; trial < 50; trial++) {
      const chunks: Buffer[] = [];
      for (let i = 0; i < stream.length;) {
        const n = 1 + Math.floor(rand() * 40);
        chunks.push(stream.subarray(i, i + n));
        i += n;
      }
      expect(run(chunks)).toEqual(whole);
    }
  });

  it("recovers from line noise between frames and still yields the same state", () => {
    const rand = mulberry32(7);
    const noise = () => Buffer.from(Array.from({ length: 1 + Math.floor(rand() * 30) }, () => {
      const b = Math.floor(rand() * 256);
      return b === STX ? 0x41 : b; // noise without a stray STX, or it would legitimately open a frame
    }));
    const clean = (() => {
      const f = new SaturnFramer();
      let s = freshState();
      for (const fr of GOLDEN_CYCLE) for (const m of f.feed(fr)) s = applySaturnMessage(m, s);
      return s;
    })();

    const framer = new SaturnFramer();
    let noisy = freshState();
    for (const fr of GOLDEN_CYCLE) {
      for (const m of framer.feed(Buffer.concat([noise(), fr]))) noisy = applySaturnMessage(m, noisy);
    }
    expect(noisy).toEqual(clean);
  });

  // Whatever a console sends — even corrupt-but-checksummed frames — the state
  // handed to the relay must remain valid, or the display freezes. Random
  // payloads on every message type, 3000 frames, seeded for reproducibility.
  it.each([1, 2, 3])("never produces a state the relay rejects, whatever the payload bytes (fuzz seed %i)", seed => {
    const rand = mulberry32(seed);
    const types = ["D", "F1", "F2", "F3", "F4", "T", "N"];
    const framer = new SaturnFramer();
    let state = freshState();

    for (let i = 0; i < 1000; i++) {
      const type = types[Math.floor(rand() * types.length)];
      const len = Math.floor(rand() * (type === "N" ? 420 : 60));
      // Avoid STX/ETX inside the payload so the framer sees one intended frame.
      const data = Array.from({ length: len }, () => {
        const b = Math.floor(rand() * 256);
        return b === STX || b === ETX ? 0x30 : b;
      });
      for (const msg of framer.feed(buildFrame(type, data))) {
        state = applySaturnMessage(msg, state);
        expectRelayAccepts(state, `fuzz seed ${seed} iteration ${i} type ${type} len ${len}`);
      }
    }
  });
});
