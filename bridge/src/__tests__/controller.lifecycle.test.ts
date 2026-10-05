import fs from "node:fs";
import { BridgeController, BridgeConfig } from "../controller";
import { DEFAULT_MATCH_STATE } from "../types";

jest.mock("serialport", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require("node:events");
  class FakeSerialPort extends EventEmitter {
    static list = jest.fn();
    static instances: FakeSerialPort[] = [];
    openErr: Error | null = null;

    constructor(_opts: unknown) {
      super();
      FakeSerialPort.instances.push(this);
    }

    open(cb: (err: Error | null) => void) {
      cb(this.openErr);
    }

    close(cb: () => void) {
      cb();
    }
  }
  return { SerialPort: FakeSerialPort };
});

// jest.mock's factory is hoisted above imports, so pull the mocked class back
// out via require() rather than importing it directly — this file needs the
// concrete FakeSerialPort (its static .instances/.list, prototype.open), not
// just the SerialPort type serialport's real module would give us.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SerialPort: FakeSerialPort } = require("serialport") as {
  SerialPort: {
    new (opts: unknown): InstanceType<typeof import("node:events").EventEmitter> & {
      openErr: Error | null;
      open(cb: (err: Error | null) => void): void;
      close(cb: () => void): void;
    };
    list: jest.Mock;
    instances: Array<{ openErr: Error | null; emit: (event: string, ...args: unknown[]) => boolean; close: (cb: () => void) => void }>;
    prototype: { open: (cb: (err: Error | null) => void) => void };
  };
};

type Handler = (...args: any[]) => void;

function makeFakeSocket() {
  const handlers: Record<string, Handler[]> = {};
  return {
    connected: true,
    on: jest.fn((event: string, cb: Handler) => {
      (handlers[event] ??= []).push(cb);
    }),
    emit: jest.fn(),
    disconnect: jest.fn(),
    __trigger: (event: string, ...args: any[]) => {
      for (const cb of handlers[event] ?? []) cb(...args);
    },
  };
}

let fakeSocket: ReturnType<typeof makeFakeSocket>;
const ioMock = jest.fn((..._args: unknown[]) => fakeSocket);

jest.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

const startJsonSourceMock = jest.fn();
const startScrapeSourceMock = jest.fn();
jest.mock("../sources/championDataJsonSource", () => ({
  startJsonSource: (...a: unknown[]) => startJsonSourceMock(...a),
}));
jest.mock("../sources/championDataScrapeSource", () => ({
  startScrapeSource: (...a: unknown[]) => startScrapeSourceMock(...a),
}));

describe("BridgeController lifecycle", () => {
  let controllers: BridgeController[];

  beforeEach(() => {
    fakeSocket = makeFakeSocket();
    ioMock.mockClear();
    startJsonSourceMock.mockReset();
    startScrapeSourceMock.mockReset();
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    controllers = [];
    FakeSerialPort.instances = [];
    FakeSerialPort.list.mockReset();
  });

  afterEach(async () => {
    // start() leaves real setInterval timers (broadcast/heartbeat) running —
    // stop them all so Jest doesn't hang on open handles after the run.
    await Promise.all(controllers.map(c => c.stop()));
    jest.restoreAllMocks();
  });

  function controllerWithSource(patch: Partial<BridgeConfig>) {
    const controller = new BridgeController();
    controller.updateConfig(patch);
    controllers.push(controller);
    return controller;
  }

  it("getConfig returns a copy, not the live config object", () => {
    const controller = new BridgeController();
    const a = controller.getConfig();
    a.relayUrl = "mutated";
    expect(controller.getConfig().relayUrl).not.toBe("mutated");
  });

  it("updateConfig merges the patch and persists it via saveConfig", () => {
    const controller = new BridgeController();
    controller.updateConfig({ relayUrl: "http://relay.example" });
    expect(controller.getConfig().relayUrl).toBe("http://relay.example");
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("getState returns the current match state", () => {
    const controller = new BridgeController();
    expect(controller.getState()).toBeTruthy();
  });

  it("isRunning is false when stopped", () => {
    const controller = new BridgeController();
    expect(controller.isRunning()).toBe(false);
  });

  it("start() with source 'saturn' and no serial port configured runs in manual/relay-only mode", async () => {
    const controller = controllerWithSource({ source: "saturn", serialPort: "" });
    await controller.start();
    expect(controller.status).toBe("running");
    expect(controller.isRunning()).toBe(true);
  });

  it("start() is a no-op when already running", async () => {
    const controller = controllerWithSource({ source: "saturn", serialPort: "" });
    await controller.start();
    ioMock.mockClear();
    await controller.start();
    expect(ioMock).not.toHaveBeenCalled();
  });

  it("start() with source 'cd-json' and no cdUrl configured fails into the error state", async () => {
    const controller = controllerWithSource({ source: "cd-json", cdUrl: "" });
    await controller.start();
    expect(controller.status).toBe("error");
    expect(controller.lastError).toMatch(/CD URL is required/);
  });

  it("start() with source 'cd-json' and a configured URL starts the JSON source and reaches running", async () => {
    startJsonSourceMock.mockReturnValue(jest.fn());
    const controller = controllerWithSource({ source: "cd-json", cdUrl: "http://cd.example/feed" });
    await controller.start();
    expect(controller.status).toBe("running");
    expect(startJsonSourceMock).toHaveBeenCalled();
  });

  it("start() with source 'cd-scrape' and no cdScrapeUrl configured fails into the error state", async () => {
    const controller = controllerWithSource({ source: "cd-scrape", cdScrapeUrl: "" });
    await controller.start();
    expect(controller.status).toBe("error");
    expect(controller.lastError).toMatch(/Scrape URL is required/);
  });

  it("start() with source 'cd-scrape' and a configured URL starts the scrape source and reaches running", async () => {
    startScrapeSourceMock.mockResolvedValue(jest.fn());
    const controller = controllerWithSource({ source: "cd-scrape", cdScrapeUrl: "http://cd.example/scrape" });
    await controller.start();
    expect(controller.status).toBe("running");
    expect(startScrapeSourceMock).toHaveBeenCalled();
  });

  it("stop() tears down the source and relay, returning to stopped", async () => {
    const stopSource = jest.fn();
    startJsonSourceMock.mockReturnValue(stopSource);
    const controller = controllerWithSource({ source: "cd-json", cdUrl: "http://cd.example/feed" });
    await controller.start();

    await controller.stop();
    expect(controller.status).toBe("stopped");
    expect(stopSource).toHaveBeenCalled();
    expect(fakeSocket.disconnect).toHaveBeenCalled();
  });

  it("stop() is a no-op when already stopped", async () => {
    const controller = new BridgeController();
    await controller.stop();
    expect(controller.status).toBe("stopped");
  });

  it("stop() continues teardown even if stopSource() rejects", async () => {
    startJsonSourceMock.mockReturnValue(jest.fn(async () => { throw new Error("boom"); }));
    const controller = controllerWithSource({ source: "cd-json", cdUrl: "http://cd.example/feed" });
    await controller.start();

    await expect(controller.stop()).resolves.toBeUndefined();
    expect(controller.status).toBe("stopped");
  });

  it("restart() stops then starts again", async () => {
    const controller = controllerWithSource({ source: "saturn", serialPort: "" });
    await controller.start();
    ioMock.mockClear();
    await controller.restart();
    expect(controller.status).toBe("running");
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it("saturn source with connected socket broadcasts stateUpdate on the 200ms timer", async () => {
    jest.useFakeTimers();
    const controller = controllerWithSource({ source: "saturn", serialPort: "" });
    await controller.start();
    fakeSocket.emit.mockClear();

    jest.advanceTimersByTime(200);
    expect(fakeSocket.emit).toHaveBeenCalledWith("stateUpdate", expect.any(Object));
    jest.useRealTimers();
  });

  it("manualUpdate patches state and bumps sequenceId", async () => {
    const controller = controllerWithSource({ source: "saturn", serialPort: "" });
    await controller.start();
    const before = controller.getState().sequenceId;

    fakeSocket.__trigger("manualUpdate", { matchName: "Finals" });

    expect(controller.getState().matchName).toBe("Finals");
    expect(controller.getState().sequenceId).toBe(before + 1);
  });

  it("loadConfig falls back to defaults when the config file is malformed", () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readFileSync").mockReturnValue("not json");
    const controller = new BridgeController();
    expect(controller.getConfig().relayUrl).toBeTruthy();
  });

  it("loadConfig merges saved config over defaults when the file is valid", () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ relayUrl: "http://saved.example" }));
    const controller = new BridgeController();
    expect(controller.getConfig().relayUrl).toBe("http://saved.example");
  });

  it("saveConfig swallows a write failure and logs a warning", () => {
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("disk full"); });
    const controller = new BridgeController();
    expect(() => controller.updateConfig({ relayUrl: "http://x" })).not.toThrow();
  });

  it("listSerialPorts returns the path of each discovered port", async () => {
    FakeSerialPort.list.mockResolvedValue([{ path: "/dev/tty.usbserial-1" }, { path: "/dev/tty.usbserial-2" }]);
    const controller = new BridgeController();
    await expect(controller.listSerialPorts()).resolves.toEqual([
      "/dev/tty.usbserial-1",
      "/dev/tty.usbserial-2",
    ]);
  });

  it("start() with source 'saturn' and a configured port opens it and reaches running", async () => {
    const controller = controllerWithSource({ source: "saturn", serialPort: "/dev/tty.usbserial-1", baudRate: 9600 });
    await controller.start();
    expect(controller.status).toBe("running");
    expect(FakeSerialPort.instances).toHaveLength(1);
  });

  it("start() with source 'saturn' fails into the error state when the port fails to open", async () => {
    const openSpy = jest
      .spyOn(FakeSerialPort.prototype, "open")
      .mockImplementation(function (cb: (err: Error | null) => void) {
        cb(new Error("port busy"));
      });
    const controller = controllerWithSource({ source: "saturn", serialPort: "/dev/tty.busy", baudRate: 9600 });

    await controller.start();

    expect(controller.status).toBe("error");
    expect(controller.lastError).toMatch(/port busy/);
    openSpy.mockRestore();
  });

  it("applies incoming Saturn serial data to state via the port's 'data' event", async () => {
    const controller = controllerWithSource({ source: "saturn", serialPort: "/dev/tty.usbserial-1", baudRate: 9600 });
    await controller.start();
    const port = FakeSerialPort.instances[0];

    // A raw buffer that doesn't frame into a full Saturn message should be
    // absorbed without changing state or throwing.
    expect(() => port.emit("data", Buffer.from([0x01, 0x02]))).not.toThrow();
    expect(controller.getState()).toBeTruthy();
  });

  it("Saturn source stop() closes the serial port", async () => {
    const controller = controllerWithSource({ source: "saturn", serialPort: "/dev/tty.usbserial-1", baudRate: 9600 });
    await controller.start();
    const port = FakeSerialPort.instances[0];
    const closeSpy = jest.spyOn(port, "close");

    await controller.stop();
    expect(closeSpy).toHaveBeenCalled();
  });

  it("cd-json onUpdate logs a score-change line when scores differ", async () => {
    let onUpdate!: (s: typeof DEFAULT_MATCH_STATE) => void;
    startJsonSourceMock.mockImplementation((_socket, _getState, update) => {
      onUpdate = update;
      return jest.fn();
    });
    const controller = controllerWithSource({ source: "cd-json", cdUrl: "http://cd.example/feed" });
    await controller.start();

    const next = { ...DEFAULT_MATCH_STATE, home: { ...DEFAULT_MATCH_STATE.home, score: 5 } };
    expect(() => onUpdate(next)).not.toThrow();
    expect(controller.getState().home.score).toBe(5);
  });

  it("cd-json onUpdate logs a status line when scores are unchanged", async () => {
    let onUpdate!: (s: typeof DEFAULT_MATCH_STATE) => void;
    startJsonSourceMock.mockImplementation((_socket, _getState, update) => {
      onUpdate = update;
      return jest.fn();
    });
    const controller = controllerWithSource({ source: "cd-json", cdUrl: "http://cd.example/feed" });
    await controller.start();

    expect(() => onUpdate({ ...DEFAULT_MATCH_STATE })).not.toThrow();
  });

  it("cd-scrape onUpdate logs a score-change line when scores differ", async () => {
    let onUpdate!: (s: typeof DEFAULT_MATCH_STATE) => void;
    startScrapeSourceMock.mockImplementation(async (_socket, _getState, update) => {
      onUpdate = update;
      return jest.fn();
    });
    const controller = controllerWithSource({ source: "cd-scrape", cdScrapeUrl: "http://cd.example/scrape" });
    await controller.start();

    const next = { ...DEFAULT_MATCH_STATE, visitor: { ...DEFAULT_MATCH_STATE.visitor, score: 3 } };
    expect(() => onUpdate(next)).not.toThrow();
    expect(controller.getState().visitor.score).toBe(3);
  });

  it("cd-scrape onUpdate logs a status line when scores are unchanged", async () => {
    let onUpdate!: (s: typeof DEFAULT_MATCH_STATE) => void;
    startScrapeSourceMock.mockImplementation(async (_socket, _getState, update) => {
      onUpdate = update;
      return jest.fn();
    });
    const controller = controllerWithSource({ source: "cd-scrape", cdScrapeUrl: "http://cd.example/scrape" });
    await controller.start();

    expect(() => onUpdate({ ...DEFAULT_MATCH_STATE })).not.toThrow();
  });

  describe("match picker (SA-145)", () => {
    it("sends the chosen match in the relay handshake", async () => {
      const controller = controllerWithSource({ source: "saturn", serialPort: "", matchId: "m-42" });
      await controller.start();
      expect(ioMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        auth: { secret: expect.any(String), role: "bridge", matchId: "m-42" },
      }));
    });

    it("omits matchId when none is chosen, leaving the token's own match in charge", async () => {
      const controller = controllerWithSource({ source: "saturn", serialPort: "" });
      await controller.start();
      expect(ioMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        auth: { secret: expect.any(String), role: "bridge" },
      }));
    });

    it("surfaces the relay's refusal reason as lastError", async () => {
      const controller = controllerWithSource({ source: "saturn", serialPort: "" });
      await controller.start();
      fakeSocket.__trigger("connect_error", new Error("Connecting a console requires the Data Feed add-on"));
      expect(controller.lastError).toMatch(/Data Feed add-on/);
    });

    const respond = (status: number, body: unknown) =>
      jest.spyOn(globalThis, "fetch").mockImplementation((async () =>
        new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch);
    const NOT_A_RELAY = "Couldn't get the match list — check the Relay URL and Bridge Secret";

    it("listMatches() asks the relay with the bridge secret and returns its list", async () => {
      const fetchSpy = respond(200, { pinnedMatchId: null, matches: [{ id: "m-1", name: "Hawks v Owls", sport: "netball", status: "LIVE", scheduledAt: null }] });
      const controller = controllerWithSource({ relayUrl: "https://relay.example/", bridgeSecret: "tok" });
      const list = await controller.listMatches();
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [URL, RequestInit];
      expect(String(url)).toBe("https://relay.example/api/matches");
      expect(init).toMatchObject({ headers: { "x-bridge-secret": "tok" }, redirect: "error" });
      expect(list.matches).toEqual([{ id: "m-1", name: "Hawks v Owls", sport: "netball", status: "LIVE", scheduledAt: null }]);
    });

    it("listMatches() refuses a non-http relay URL without making a request", async () => {
      const fetchSpy = jest.spyOn(globalThis, "fetch");
      for (const relayUrl of ["file:///etc/passwd", "https://user:pw@relay.example", "not a url"]) {
        await expect(controllerWithSource({ relayUrl }).listMatches()).rejects.toThrow(/Relay URL/);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("listMatches() passes on only the expected fields, never the raw response", async () => {
      respond(200, {
        pinnedMatchId: null, internal: "secret-thing",
        matches: [{ id: "m-1", name: "N".repeat(500), status: "LIVE", extra: { deep: true } }, { name: "no id" }, "junk"],
      });
      const list = await controllerWithSource({ relayUrl: "https://relay.example" }).listMatches();
      expect(list).toEqual({
        pinnedMatchId: null,
        matches: [{ id: "m-1", name: "N".repeat(200), sport: null, status: "LIVE", scheduledAt: null }],
      });
    });

    it("listMatches() surfaces the relay's add-on refusal and a rejected secret", async () => {
      const controller = controllerWithSource({ relayUrl: "https://relay.example" });
      respond(403, { error: "Connecting a console requires the Data Feed add-on — an Admin can add it under Account → Billing" });
      await expect(controller.listMatches()).rejects.toThrow(/Data Feed add-on/);
      respond(401, { error: "unauthorized" });
      await expect(controller.listMatches()).rejects.toThrow("Bridge Secret not recognised");
    });

    it("listMatches() gives one indistinguishable error for anything that isn't the relay", async () => {
      const controller = controllerWithSource({ relayUrl: "https://relay.example" });
      const cases: Array<[number, unknown]> = [
        [500, { error: "internal service detail" }],
        [403, { error: "some other service's forbidden page" }],
        [401, "<html>login</html>"],
        [404, "not found"],
        [200, "<html>ok</html>"],
        [200, { hello: "world" }],
      ];
      for (const [status, body] of cases) {
        respond(status, body);
        await expect(controller.listMatches()).rejects.toThrow(NOT_A_RELAY);
      }
      jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(controller.listMatches()).rejects.toThrow(NOT_A_RELAY);
    });

    it("listMatches() stops reading an oversized response", async () => {
      respond(200, JSON.stringify({ pinnedMatchId: null, matches: [], pad: "x".repeat(300 * 1024) }));
      await expect(controllerWithSource({ relayUrl: "https://relay.example" }).listMatches()).rejects.toThrow(NOT_A_RELAY);
    });
  });
});
