/**
 * BridgeController — manages the relay socket connection and the active
 * data source (Saturn serial / ChampionData JSON / ChampionData scraper).
 * The UI server calls start/stop/restart to drive the lifecycle.
 */

import { io, Socket } from "socket.io-client";
import { SerialPort } from "serialport";
import { SaturnFramer, applySaturnMessage } from "./protocol/saturnParser";
import { startJsonSource } from "./sources/championDataJsonSource";
import { startScrapeSource } from "./sources/championDataScrapeSource";
import { MatchState, DEFAULT_MATCH_STATE } from "./types";
import { log } from "./logger";
import fs from "node:fs";
import path from "node:path";

export type SourceType = "saturn" | "cd-json" | "cd-scrape";

export interface BridgeConfig {
  relayUrl: string;
  bridgeSecret: string;
  // The match this bridge feeds, chosen in the UI's match picker. Empty means
  // "whatever the token says" — a token pinned to a match in the control
  // panel, or otherwise the organisation's default match.
  matchId: string;
  source: SourceType;
  // Saturn
  serialPort: string;
  baudRate: number;
  // CD JSON
  cdUrl: string;
  cdUsername: string;
  cdPassword: string;
  cdPollMs: number;
  // CD Scrape
  cdScrapeUrl: string;
  cdScrapePollMs: number;
}

export interface RelayMatchOption {
  id: string;
  name: string;
  sport: string | null;
  status: string;
  scheduledAt: string | null;
}

export interface RelayMatchList {
  pinnedMatchId: string | null;
  matches: RelayMatchOption[];
}

export type BridgeStatus = "stopped" | "connecting" | "running" | "error";

// BRIDGE_CONFIG_DIR is set by the Electron main process (electron/main.ts) to
// app.getPath("userData") before this module loads, since a packaged app has
// no predictable cwd. Falls back to cwd for the plain `npm start` / Docker path.
const CONFIG_PATH = path.join(process.env.BRIDGE_CONFIG_DIR ?? process.cwd(), "bridge-config.json");

// How long the relay socket can stay disconnected before we treat it as an
// outage worth alerting on, rather than a normal brief reconnect blip (SA-29).
const RELAY_OUTAGE_ALERT_MS = 60_000;
const RELAY_HEARTBEAT_CHECK_MS = 5_000;

const DEFAULT_CONFIG: BridgeConfig = {
  relayUrl: process.env.RELAY_URL ?? "http://localhost:4000",
  bridgeSecret: process.env.BRIDGE_SECRET ?? "changeme",
  matchId: process.env.MATCH_ID ?? "",
  source: (process.env.CD_SOURCE as SourceType) ?? "saturn",
  serialPort: process.env.SERIAL_PORT ?? "",
  baudRate: Number.parseInt(process.env.BAUD_RATE ?? "9600", 10),
  cdUrl: process.env.CD_URL ?? "",
  cdUsername: process.env.CD_USERNAME ?? "",
  cdPassword: process.env.CD_PASSWORD ?? "",
  cdPollMs: Number.parseInt(process.env.CD_POLL_MS ?? "2000", 10),
  cdScrapeUrl: process.env.CD_SCRAPE_URL ?? "",
  cdScrapePollMs: Number.parseInt(process.env.CD_POLL_MS ?? "500", 10),
};

const RELAY_MATCH_LIST_TIMEOUT_MS = 5_000;

function capText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

export class BridgeController {
  private config: BridgeConfig;
  private state: MatchState = { ...DEFAULT_MATCH_STATE };
  private socket: Socket | null = null;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private disconnectedSince: number | null = null;
  private alertedRelayOutage = false;
  private stopSource: (() => void | Promise<void>) | null = null;
  private serialPort: SerialPort | null = null;
  public status: BridgeStatus = "stopped";
  public lastError: string = "";

  constructor() {
    this.config = this.loadConfig();
  }

  getConfig(): BridgeConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<BridgeConfig>): void {
    this.config = { ...this.config, ...patch };
    this.saveConfig();
  }

  getState(): MatchState {
    return this.state;
  }

  isRunning(): boolean {
    return this.status === "running" || this.status === "connecting";
  }

  getRelayHealth(): { connected: boolean; disconnectedSince: number | null; outageAlerted: boolean } {
    return {
      connected: this.socket?.connected ?? false,
      disconnectedSince: this.disconnectedSince,
      outageAlerted: this.alertedRelayOutage,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning()) {
      log.warn("Already running — stop first");
      return;
    }

    this.status = "connecting";
    this.lastError = "";
    log.info(`Starting bridge — source: ${this.config.source}, relay: ${this.config.relayUrl}`);

    try {
      this.connectRelay();
      await this.startSource();
      this.status = "running";
      log.info("Bridge running");
    } catch (err) {
      this.status = "error";
      this.lastError = (err as Error).message;
      log.error(`Failed to start: ${this.lastError}`);
      await this.teardownSource();
      this.teardownRelay();
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning() && this.status !== "error") return;
    log.info("Stopping bridge");
    await this.teardownSource();
    this.teardownRelay();
    this.status = "stopped";
    log.info("Bridge stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  // Asks the relay which matches this bridge token can feed, for the UI's
  // match picker. Throws with the relay's own message (e.g. the Data Feed
  // add-on prompt) so the UI can show it as-is.
  //
  // relayUrl is operator-supplied and legitimately points at localhost or a
  // LAN address in dev/self-hosted setups, so it can't be host-restricted the
  // way cdScrapeUrl is. Instead this request is kept from being a useful
  // probe of whatever that URL points at: http(s) only, no redirects, a short
  // timeout, and only the expected, length-capped fields are passed on —
  // never the raw response body.
  async listMatches(): Promise<RelayMatchList> {
    const { relayUrl, bridgeSecret } = this.config;
    let url: URL;
    try {
      url = new URL("/api/matches", relayUrl);
    } catch {
      throw new Error("Relay URL isn't a valid URL");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new Error("Relay URL must be a plain http or https address");
    }

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "x-bridge-secret": bridgeSecret },
        redirect: "error",
        signal: AbortSignal.timeout(RELAY_MATCH_LIST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Couldn't reach the relay — check the Relay URL");
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      if (res.status === 401) throw new Error("Bridge Secret not recognised");
      const relayError = capText(body?.error, 200);
      throw new Error(res.status === 403 && relayError ? relayError : `Relay returned ${res.status}`);
    }
    const rows = Array.isArray(body?.matches) ? body.matches.slice(0, 100) : [];
    return {
      pinnedMatchId: capText(body?.pinnedMatchId, 64),
      matches: rows.flatMap((row: unknown) => {
        const m = (row ?? {}) as Record<string, unknown>;
        const id = capText(m.id, 64);
        if (!id) return [];
        return [{
          id,
          name: capText(m.name, 200) ?? "Match",
          sport: capText(m.sport, 40),
          status: capText(m.status, 20) ?? "",
          scheduledAt: capText(m.scheduledAt, 40),
        }];
      }),
    };
  }

  async listSerialPorts(): Promise<string[]> {
    const ports = await SerialPort.list();
    return ports.map(p => p.path);
  }

  // ─── Relay connection ───────────────────────────────────────────────────────

  private connectRelay(): void {
    const { relayUrl, bridgeSecret, matchId } = this.config;

    this.socket = io(relayUrl, {
      auth: { secret: bridgeSecret, role: "bridge", ...(matchId ? { matchId } : {}) },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
    });

    this.socket.on("connect", () => {
      log.relay(`Connected to relay at ${relayUrl}`);
      this.disconnectedSince = null;
      this.alertedRelayOutage = false;
      this.socket!.emit("stateUpdate", this.state);
    });

    // The relay refuses a bridge handshake with a reason worth showing the
    // operator (no Data Feed add-on, selected match ended) — socket.io keeps
    // retrying, so log each distinct reason once rather than every attempt.
    let lastConnectError = "";
    this.socket.on("connect_error", err => {
      this.disconnectedSince ??= Date.now();
      if (err.message === lastConnectError) return;
      lastConnectError = err.message;
      this.lastError = err.message;
      log.error(`Relay refused the connection: ${err.message}`);
    });

    this.socket.on("disconnect", reason => {
      log.relay(`Disconnected from relay: ${reason}`);
      this.disconnectedSince = Date.now();
    });

    this.heartbeatTimer = setInterval(() => {
      if (
        this.disconnectedSince !== null &&
        !this.alertedRelayOutage &&
        Date.now() - this.disconnectedSince >= RELAY_OUTAGE_ALERT_MS
      ) {
        this.alertedRelayOutage = true;
        log.error(
          `Relay unreachable for over ${RELAY_OUTAGE_ALERT_MS / 1000}s — switch to manual control if the match is live`
        );
      }
    }, RELAY_HEARTBEAT_CHECK_MS);

    this.socket.on("manualUpdate", (patch: Partial<MatchState>) => {
      this.state = { ...this.state, ...patch, sequenceId: this.state.sequenceId + 1 };
      log.info("State patched from control panel");
    });

    // Adopts the relay's sequenceId (never its score/clock fields — those stay
    // hardware-sourced) whenever it's ahead of ours. Without this, reconnecting
    // after any manualUpdate we missed while disconnected leaves our counter
    // permanently behind, so the relay's `>=` check in its stateUpdate handler
    // silently rejects every subsequent broadcast for the rest of the match.
    this.socket.on("matchStateChange", (state: MatchState) => {
      if (state.sequenceId > this.state.sequenceId) {
        this.state = { ...this.state, sequenceId: state.sequenceId };
      }
    });

    // Saturn source broadcasts on a timer; CD sources push immediately on each poll
    if (this.config.source === "saturn") {
      this.broadcastTimer = setInterval(() => {
        if (this.socket?.connected) {
          this.socket.emit("stateUpdate", this.state);
        }
      }, 200);
    }
  }

  private teardownRelay(): void {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.disconnectedSince = null;
    this.alertedRelayOutage = false;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // ─── Source management ──────────────────────────────────────────────────────

  private async startSource(): Promise<void> {
    const { source } = this.config;

    if (source === "saturn") {
      await this.startSaturn();
    } else if (source === "cd-json") {
      this.startCdJson();
    } else if (source === "cd-scrape") {
      await this.startCdScrape();
    }
  }

  private async startSaturn(): Promise<void> {
    const { serialPort: portName, baudRate } = this.config;

    if (!portName) {
      log.warn("No serial port configured — running in manual/relay-only mode");
      this.stopSource = () => {};
      return;
    }

    const framer = new SaturnFramer();
    const port = new SerialPort({
      path: portName,
      baudRate,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      port.open(err => (err ? reject(err) : resolve()));
    });

    port.on("data", (data: Buffer) => {
      const messages = framer.feed(data);
      for (const msg of messages) {
        const next = applySaturnMessage(msg, this.state);
        if (next !== this.state) {
          this.state = { ...next, inputSource: portName };
          log.data(`Saturn → score ${this.state.home.score}–${this.state.visitor.score} period ${this.state.period}`);
        }
      }
    });

    port.on("error", err => log.error(`Serial error: ${err.message}`));
    port.on("close", () => log.warn("Serial port closed"));

    this.serialPort = port;
    this.stopSource = async () => {
      await new Promise<void>(res => port.close(() => res()));
      this.serialPort = null;
    };

    log.info(`Saturn: listening on ${portName} @ ${baudRate} baud`);
  }

  private startCdJson(): void {
    const { cdUrl, cdUsername, cdPassword, cdPollMs } = this.config;
    if (!cdUrl) throw new Error("CD URL is required for cd-json source");

    const stop = startJsonSource(
      this.socket!,
      () => this.state,
      (s) => {
        const prev = this.state;
        this.state = s;
        if (s.home.score !== prev.home.score || s.visitor.score !== prev.visitor.score) {
          log.data(`JSON poll → ${s.home.name} ${s.home.score}–${s.visitor.score} ${s.visitor.name}`);
        } else {
          log.data(`JSON poll → match ${s.netballStats?.matchStatus ?? "unknown"}`);
        }
      },
      { url: cdUrl, username: cdUsername || undefined, password: cdPassword || undefined, pollMs: cdPollMs }
    );

    this.stopSource = stop;
    log.info(`ChampionData JSON: polling ${cdUrl} every ${cdPollMs}ms`);
  }

  private async startCdScrape(): Promise<void> {
    const { cdScrapeUrl, cdScrapePollMs } = this.config;
    if (!cdScrapeUrl) throw new Error("Scrape URL is required for cd-scrape source");

    const stop = await startScrapeSource(
      this.socket!,
      () => this.state,
      (s) => {
        const prev = this.state;
        this.state = s;
        if (s.home.score !== prev.home.score || s.visitor.score !== prev.visitor.score) {
          log.data(`Scrape → ${s.home.name} ${s.home.score}–${s.visitor.score} ${s.visitor.name}`);
        } else {
          log.data(`Scrape → match ${s.netballStats?.matchStatus ?? "unknown"}`);
        }
      },
      { url: cdScrapeUrl, pollMs: cdScrapePollMs }
    );

    this.stopSource = stop;
    log.info(`ChampionData Scrape: ${cdScrapeUrl} every ${cdScrapePollMs}ms`);
  }

  private async teardownSource(): Promise<void> {
    if (this.stopSource) {
      try {
        await this.stopSource();
      } catch (err) {
        log.warn(`teardownSource: stopSource() failed, continuing teardown: ${(err as Error).message}`);
      }
      this.stopSource = null;
    }
    this.serialPort = null;
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  private loadConfig(): BridgeConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
        return { ...DEFAULT_CONFIG, ...saved };
      }
    } catch (err) {
      log.warn(`loadConfig: failed to read/parse ${CONFIG_PATH}, falling back to defaults: ${(err as Error).message}`);
    }
    return { ...DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
    } catch (err) {
      log.warn(`Could not save config: ${(err as Error).message}`);
    }
  }
}
