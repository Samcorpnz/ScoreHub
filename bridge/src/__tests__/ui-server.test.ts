import request from "supertest";
import { AddressInfo } from "node:net";
import { createUiServer } from "../ui/server";
import { BridgeController } from "../controller";
import { DEFAULT_MATCH_STATE } from "../types";

// Only the subset of BridgeController that ui/server.ts actually touches is
// exercised here — full lifecycle behaviour (serial port, sources, relay
// socket) is covered by controller.test.ts / controller.lifecycle.test.ts.
function makeFakeController(overrides: Partial<BridgeController> = {}): BridgeController {
  const config = {
    relayUrl: "http://localhost:4000",
    bridgeSecret: "secret",
    matchId: "",
    source: "saturn" as const,
    serialPort: "",
    baudRate: 9600,
    cdUrl: "",
    cdUsername: "",
    cdPassword: "",
    cdPollMs: 2000,
    cdScrapeUrl: "",
    cdScrapePollMs: 500,
  };

  const controller = {
    status: "stopped",
    lastError: "",
    getConfig: jest.fn(() => ({ ...config })),
    updateConfig: jest.fn(),
    getState: jest.fn(() => ({ ...DEFAULT_MATCH_STATE })),
    getRelayHealth: jest.fn(() => ({ connected: false, disconnectedSince: null, outageAlerted: false })),
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    restart: jest.fn(async () => {}),
    listSerialPorts: jest.fn(async () => ["/dev/tty.usbserial-1"]),
    listMatches: jest.fn(async () => ({ pinnedMatchId: null, matches: [{ id: "m-1", name: "Hawks v Owls", sport: "netball", status: "LIVE", scheduledAt: null }] })),
    ...overrides,
  };

  return controller as unknown as BridgeController;
}

describe("bridge ui server", () => {
  let controller: BridgeController;
  let server: ReturnType<typeof createUiServer>;
  let baseUrl: string;

  beforeEach(done => {
    controller = makeFakeController();
    server = createUiServer(controller, 0);
    server.on("listening", () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterEach(done => {
    server.close(() => done());
  });

  it("GET /api/status returns controller status, relay health and derived state", async () => {
    const res = await request(baseUrl).get("/api/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "stopped",
      lastError: "",
      relay: { connected: false, disconnectedSince: null, outageAlerted: false },
      state: {
        home: DEFAULT_MATCH_STATE.home.score,
        visitor: DEFAULT_MATCH_STATE.visitor.score,
        matchName: DEFAULT_MATCH_STATE.matchName,
        isRunning: DEFAULT_MATCH_STATE.isRunning,
        period: DEFAULT_MATCH_STATE.period,
        inputSource: DEFAULT_MATCH_STATE.inputSource,
      },
    });
  });

  it("GET /api/config returns the controller's config", async () => {
    const res = await request(baseUrl).get("/api/config");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ relayUrl: "http://localhost:4000", source: "saturn" });
    expect(controller.getConfig).toHaveBeenCalled();
  });

  it("POST /api/config coerces numeric fields sent as strings", async () => {
    const res = await request(baseUrl)
      .post("/api/config")
      .send({ baudRate: "19200", cdPollMs: "3000", cdScrapePollMs: "750" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(controller.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ baudRate: 19200, cdPollMs: 3000, cdScrapePollMs: 750 }),
    );
  });

  it("POST /api/config accepts a valid public https cdScrapeUrl", async () => {
    const res = await request(baseUrl)
      .post("/api/config")
      .send({ cdScrapeUrl: "https://example.com/scores" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(controller.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ cdScrapeUrl: "https://example.com/scores" }),
    );
  });

  it("POST /api/config rejects a cdScrapeUrl pointing at a private/reserved host (SSRF guard)", async () => {
    const res = await request(baseUrl)
      .post("/api/config")
      .send({ cdScrapeUrl: "http://127.0.0.1:8080/scores" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/not allowed/i);
    expect(controller.updateConfig).not.toHaveBeenCalled();
  });

  it("POST /api/config rejects a cdScrapeUrl with an unsupported protocol", async () => {
    const res = await request(baseUrl)
      .post("/api/config")
      .send({ cdScrapeUrl: "ftp://example.com/scores" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/http or https/i);
  });

  it("POST /api/config rejects a cdScrapeUrl containing credentials", async () => {
    const res = await request(baseUrl)
      .post("/api/config")
      .send({ cdScrapeUrl: "https://user:pass@example.com/scores" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/credentials/i);
  });

  it("POST /api/start calls controller.start and returns status", async () => {
    const res = await request(baseUrl).post("/api/start");
    expect(res.status).toBe(200);
    expect(controller.start).toHaveBeenCalled();
    expect(res.body).toMatchObject({ status: "stopped", lastError: "" });
  });

  it("POST /api/stop calls controller.stop and returns status", async () => {
    const res = await request(baseUrl).post("/api/stop");
    expect(res.status).toBe(200);
    expect(controller.stop).toHaveBeenCalled();
    expect(res.body).toMatchObject({ status: "stopped" });
  });

  it("POST /api/restart calls controller.restart and returns status", async () => {
    const res = await request(baseUrl).post("/api/restart");
    expect(res.status).toBe(200);
    expect(controller.restart).toHaveBeenCalled();
    expect(res.body).toMatchObject({ status: "stopped", lastError: "" });
  });

  it("GET /api/ports returns the list of serial ports from the controller", async () => {
    const res = await request(baseUrl).get("/api/ports");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ports: ["/dev/tty.usbserial-1"] });
  });

  it("GET /api/ports returns an empty list with an error message when listing fails", async () => {
    controller = makeFakeController({
      listSerialPorts: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    await new Promise<void>(resolve => server.close(() => resolve()));
    server = createUiServer(controller, 0);
    await new Promise<void>(resolve => {
      server.on("listening", () => {
        const port = (server.address() as AddressInfo).port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });

    const res = await request(baseUrl).get("/api/ports");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ports: [], error: "boom" });
  });

  it("GET /api/logs opens an SSE stream with the right headers", done => {
    const http = require("node:http") as typeof import("node:http");
    const port = (server.address() as AddressInfo).port;
    const req = http.get(`http://localhost:${port}/api/logs`, res => {
      expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
      expect(res.headers["cache-control"]).toBe("no-cache");
      req.destroy();
      done();
    });
  });

  it("GET /api/matches returns the relay's match list for the picker", async () => {
    const res = await request(baseUrl).get("/api/matches");
    expect(res.body).toMatchObject({ ok: true, pinnedMatchId: null, matches: [{ id: "m-1", name: "Hawks v Owls" }] });
  });

  it("GET /api/matches reports the relay's error instead of failing", async () => {
    (controller.listMatches as jest.Mock).mockRejectedValueOnce(new Error("Connecting a console requires the Data Feed add-on"));
    const res = await request(baseUrl).get("/api/matches");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, matches: [], error: expect.stringMatching(/Data Feed add-on/) });
  });
});
