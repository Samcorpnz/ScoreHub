/**
 * Swiss Timing Saturn/Vega serial protocol parser — spec 0100.073.02 v2.0
 *
 * Framing: <STX>(0x02) + type(1-2 bytes) + data + <ETX>(0x03) + CRC(XOR STX..ETX)
 * Cycle: base message 'D' + option messages, repeated every ~100 ms.
 */

import { MatchState, TeamPlayer, SportType, Possession } from "../types";
import { log } from "../logger";

const STX = 0x02;
const ETX = 0x03;

export interface SaturnMessage {
  type: string;
  raw: Buffer;
}

/** Stateful byte accumulator — call feed() with each incoming chunk. */
export class SaturnFramer {
  private buf: number[] = [];
  private inFrame = false;
  private prevWasEtx = false;

  feed(data: Buffer): SaturnMessage[] {
    const out: SaturnMessage[] = [];

    for (const byte of data) {
      if (byte === STX) {
        this.buf = [byte];
        this.inFrame = true;
        this.prevWasEtx = false;
        continue;
      }
      if (!this.inFrame) continue;

      this.buf.push(byte);

      if (this.prevWasEtx) {
        // This byte is the CRC
        const frame = Buffer.from(this.buf);
        this.buf = [];
        this.inFrame = false;
        this.prevWasEtx = false;
        if (isValidFrame(frame)) {
          out.push(extractMessage(frame));
        }
        continue;
      }

      this.prevWasEtx = byte === ETX;
    }

    return out;
  }
}

function isValidFrame(frame: Buffer): boolean {
  if (frame.length < 4) return false;
  let crc = 0;
  for (let i = 0; i < frame.length - 1; i++) crc ^= frame[i];
  return crc === frame.at(-1);
}

function extractMessage(frame: Buffer): SaturnMessage {
  const c1 = String.fromCodePoint(frame[1]);
  const c2 = frame.length > 4 ? String.fromCodePoint(frame[2]) : "";
  const type =
    c1 === "F" && ["1", "2", "3", "4"].includes(c2) ? c1 + c2 : c1;
  return { type, raw: frame };
}

// ─── Message applicators ───────────────────────────────────────────────────

export function applySaturnMessage(
  msg: SaturnMessage,
  state: MatchState
): MatchState {
  try {
    switch (msg.type) {
      case "D":  return applyBase(msg.raw, state);
      case "F1": return applyShirtFaults(msg.raw, state, "home");
      case "F2": return applyShirtFaults(msg.raw, state, "visitor");
      case "F3": return applyPoints(msg.raw, state, "home");
      case "F4": return applyPoints(msg.raw, state, "visitor");
      case "N":  return applyNames(msg.raw, state);
      case "T":  return applyDateTime(msg.raw, state);
      default:   return state;
    }
  } catch (err) {
    log.error(`saturnParser: failed to apply '${msg.type}' message: ${err instanceof Error ? err.message : err}`);
    return state;
  }
}

/**
 * 'D' — base message, 27 bytes total.
 *
 * Byte layout (0-indexed from frame start):
 *   0      STX
 *   1      'D'
 *   2..6   clock "MM:SS"
 *   6..7   spaces
 *   8..10  home score (3 digits, space-padded)
 *  11..13  visitor score
 *  14      home faults
 *  15      visitor faults
 *  16      home timeouts
 *  17      visitor timeouts
 *  18      period char
 *  19      possession (0-3)
 *  20      start/stop (0=stop,1=start,2=stop+shotclock,3=start+shotclock)
 *  21      horn (0/1/2/3)
 *  22..23  timeout active
 *  24..25  ball possession active
 *  26      ETX
 *  27      CRC  (total 28 bytes including CRC)
 */
function applyBase(raw: Buffer, state: MatchState): MatchState {
  const ascii = (i: number) => String.fromCodePoint(raw[i]);

  const clockStr = raw.subarray(2, 7).toString("ascii");
  const cm = /^\s*(\d+):(\s*\d+)$/.exec(clockStr);
  const clockSeconds = cm
    ? Number.parseInt(cm[1]) * 60 + Number.parseInt(cm[2].trim())
    : state.clockSeconds;

  const homeScore  = parsePaddedInt(raw.subarray(8, 11)) ?? state.home.score;
  const visScore   = parsePaddedInt(raw.subarray(11, 14)) ?? state.visitor.score;
  const homeFaults = parseSingleDigit(raw[14]) ?? state.home.faults;
  const visFaults  = parseSingleDigit(raw[15]) ?? state.visitor.faults;
  const homeTOs    = parseSingleDigit(raw[16]) ?? state.home.timeouts;
  const visTOs     = parseSingleDigit(raw[17]) ?? state.visitor.timeouts;

  const periodChar = ascii(18);
  const period = periodChar.trim() === "" ? state.period : periodChar;

  const possession  = toPossession(parseSingleDigit(raw[19]));
  const ssCode      = parseSingleDigit(raw[20]) ?? 0;
  const isRunning   = ssCode === 1 || ssCode === 3;
  const hornCode    = parseSingleDigit(raw[21]) ?? 0;
  const hornActive  = hornCode === 1 || hornCode === 3;

  return {
    ...state,
    sequenceId: state.sequenceId + 1,
    clockSeconds, period, isRunning, possession, hornActive,
    home:    { ...state.home,    score: homeScore, faults: homeFaults, timeouts: homeTOs },
    visitor: { ...state.visitor, score: visScore,  faults: visFaults,  timeouts: visTOs  },
  };
}

/**
 * 'F1'/'F2' — shirt numbers + faults, 53 bytes.
 * Data from byte 3: 3 bytes per player × 16 players.
 *   byte 0 of triplet: tens of shirt (bit 7 = on court flag)
 *   byte 1 of triplet: units of shirt
 *   byte 2 of triplet: faults count (ASCII digit)
 */
function applyShirtFaults(
  raw: Buffer,
  state: MatchState,
  team: "home" | "visitor"
): MatchState {
  const existing = (team === "home" ? state.home : state.visitor).players;
  const players: TeamPlayer[] = [];

  for (let i = 0; i < 16; i++) {
    const base = 3 + i * 3;
    if (base + 2 >= raw.length) break;

    const dmByte = raw[base];
    const onCourt = (dmByte & 0x80) !== 0;
    const tens = dmByte & 0x0f;
    const units = raw[base + 1] & 0x0f;
    const shirtNumber = tens * 10 + units;
    if (shirtNumber === 0 && !onCourt) continue;

    const faults = Math.max(0, raw[base + 2] - 0x30);
    const prev = existing.find(p => p.number === shirtNumber);
    players.push({
      number: shirtNumber,
      name: prev?.name ?? "",
      onCourt,
      faults,
      points: prev?.points ?? 0,
    });
  }

  const updated = { ...(team === "home" ? state.home : state.visitor), players };
  return {
    ...state,
    sequenceId: state.sequenceId + 1,
    ...(team === "home" ? { home: updated } : { visitor: updated }),
  };
}

/**
 * 'F3'/'F4' — individual points, 37 bytes.
 * Data from byte 3: 2 bytes per player × 16 (tens, units of points).
 */
function applyPoints(
  raw: Buffer,
  state: MatchState,
  team: "home" | "visitor"
): MatchState {
  const teamState = team === "home" ? state.home : state.visitor;
  const players = [...teamState.players];

  for (let i = 0; i < Math.min(16, players.length); i++) {
    const base = 3 + i * 2;
    if (base + 1 >= raw.length) break;
    // Non-digit bytes (e.g. a space-padded field) count as 0. Subtracting
    // 0x30 unchecked yields a negative number, which the relay's stateUpdate
    // schema rejects for the *whole* state — freezing every display.
    const points = digitOrZero(raw[base]) * 10 + digitOrZero(raw[base + 1]);
    players[i] = { ...players[i], points };
  }

  const updated = { ...teamState, players };
  return {
    ...state,
    ...(team === "home" ? { home: updated } : { visitor: updated }),
  };
}

/**
 * 'N' — team + player names, up to 411 bytes.
 * 12 chars per name: home team @ 2, visitor team @ 14,
 * home players @ 26, visitor players @ 218.
 */
function applyNames(raw: Buffer, state: MatchState): MatchState {
  // Bounds-checked: returns null (caller falls back to the existing name)
  // unless the full 12-byte field is present. Also strips non-printable
  // bytes — a truncated/misaligned frame can otherwise read into the
  // trailing ETX/CRC bytes and produce a garbage "name" from control
  // characters that .trim() alone wouldn't catch (SA-9).
  const name = (offset: number): string | null => {
    if (offset + 12 > raw.length) return null;
    // eslint-disable-next-line no-control-regex
    const cleaned = raw.subarray(offset, offset + 12).toString("ascii").replace(/[^\x20-\x7e]/g, "").trim();
    return cleaned || null;
  };

  const homeName    = name(2)  ?? state.home.name;
  const visitorName = name(14) ?? state.visitor.name;

  const homePlayers    = state.home.players.map((p, i) => {
    const playerName = name(26 + i * 12);
    return playerName !== null ? { ...p, name: playerName } : p;
  });
  const visitorPlayers = state.visitor.players.map((p, i) => {
    const playerName = name(218 + i * 12);
    return playerName !== null ? { ...p, name: playerName } : p;
  });

  return {
    ...state,
    sequenceId: state.sequenceId + 1,
    home:    { ...state.home,    name: homeName,    players: homePlayers    },
    visitor: { ...state.visitor, name: visitorName, players: visitorPlayers },
  };
}

/**
 * 'T' — date/time + config, 28 bytes.
 * Sport byte at raw[19]; period number at raw[21].
 */
function applyDateTime(raw: Buffer, state: MatchState): MatchState {
  if (raw.length < 22) return state;
  const sport = toSport(raw[19] - 0x30);
  return { ...state, sport };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Digits only: parseInt would happily read "-5" as -5 or "12x" as 12, and a
// negative score is rejected by the relay's stateUpdate schema (see applyPoints).
function parsePaddedInt(buf: Buffer): number | null {
  const s = buf.toString("ascii").trim();
  if (!/^\d+$/.test(s)) return null;
  return Number.parseInt(s, 10);
}

function digitOrZero(byte: number): number {
  return byte >= 0x30 && byte <= 0x39 ? byte - 0x30 : 0;
}

function parseSingleDigit(byte: number): number | null {
  const n = byte - 0x30;
  return n >= 0 && n <= 9 ? n : null;
}

function toPossession(code: number | null): Possession {
  switch (code) {
    case 1: return "home";
    case 2: return "visitor";
    case 3: return "both";
    default: return "none";
  }
}

function toSport(code: number): SportType {
  const map: SportType[] = [
    "netball", "volleyball", "football",
    "handball", "hockey", "waterpolo", "tennis",
    "basketball", "rugby_union", "rugby_league",
  ];
  return map[code] ?? "custom";
}
