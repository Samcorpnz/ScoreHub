import path from "node:path";
import fs from "node:fs";

// These pull in node-fetch (ESM), which Jest can't parse — same mocks as
// controller.test.ts/controller.lifecycle.test.ts.
jest.mock("../sources/championDataJsonSource", () => ({ startJsonSource: jest.fn() }));
jest.mock("../sources/championDataScrapeSource", () => ({ startScrapeSource: jest.fn() }));
jest.mock("socket.io-client", () => ({ io: jest.fn(() => ({ on: jest.fn(), emit: jest.fn(), connected: false })) }));

// CONFIG_PATH is computed once at module load from BRIDGE_CONFIG_DIR (falling
// back to cwd), so each case needs a fresh module instance — see
// electron/main.ts, which sets BRIDGE_CONFIG_DIR before ../controller loads.
describe("controller config path", () => {
  const ORIGINAL_ENV = process.env.BRIDGE_CONFIG_DIR;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.BRIDGE_CONFIG_DIR;
    else process.env.BRIDGE_CONFIG_DIR = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it("persists to BRIDGE_CONFIG_DIR/bridge-config.json when set (Electron userData path)", () => {
    process.env.BRIDGE_CONFIG_DIR = "/fake/userData";

    jest.isolateModules(() => {
      const writeFileSync = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      const { BridgeController } = require("../controller");
      const controller = new BridgeController();
      controller.updateConfig({ relayUrl: "http://x" });

      expect(writeFileSync).toHaveBeenCalledWith(
        path.join("/fake/userData", "bridge-config.json"),
        expect.any(String),
      );
    });
  });

  it("falls back to process.cwd()/bridge-config.json when BRIDGE_CONFIG_DIR is unset", () => {
    delete process.env.BRIDGE_CONFIG_DIR;

    jest.isolateModules(() => {
      const writeFileSync = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
      const { BridgeController } = require("../controller");
      const controller = new BridgeController();
      controller.updateConfig({ relayUrl: "http://x" });

      expect(writeFileSync).toHaveBeenCalledWith(
        path.join(process.cwd(), "bridge-config.json"),
        expect.any(String),
      );
    });
  });
});

// DEFAULT_CONFIG is also computed at module load. The desktop app (Electron
// sets BRIDGE_CONFIG_DIR) defaults to ScoreHub's hosted relay so customers
// don't enter a URL (SA-146); plain dev/Docker runs stay local.
describe("controller default relay URL", () => {
  const ORIGINAL = { dir: process.env.BRIDGE_CONFIG_DIR, relay: process.env.RELAY_URL };

  function freshDefaultRelayUrl(saved?: object): string {
    let relayUrl = "";
    jest.isolateModules(() => {
      jest.spyOn(fs, "existsSync").mockReturnValue(saved !== undefined);
      if (saved) jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(saved));
      const { BridgeController } = require("../controller");
      relayUrl = new BridgeController().getConfig().relayUrl;
    });
    return relayUrl;
  }

  afterEach(() => {
    for (const [key, value] of [["BRIDGE_CONFIG_DIR", ORIGINAL.dir], ["RELAY_URL", ORIGINAL.relay]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it("is the hosted relay in the desktop app", () => {
    process.env.BRIDGE_CONFIG_DIR = "/fake/userData";
    delete process.env.RELAY_URL;
    expect(freshDefaultRelayUrl()).toBe("https://relay.scorehub.co.nz");
  });

  it("stays local outside the desktop app", () => {
    delete process.env.BRIDGE_CONFIG_DIR;
    delete process.env.RELAY_URL;
    expect(freshDefaultRelayUrl()).toBe("http://localhost:4000");
  });

  it("is overridden by RELAY_URL", () => {
    process.env.BRIDGE_CONFIG_DIR = "/fake/userData";
    process.env.RELAY_URL = "https://scorehub-relay-uat.fly.dev";
    expect(freshDefaultRelayUrl()).toBe("https://scorehub-relay-uat.fly.dev");
  });

  it("never replaces a relay URL the operator already saved", () => {
    process.env.BRIDGE_CONFIG_DIR = "/fake/userData";
    delete process.env.RELAY_URL;
    expect(freshDefaultRelayUrl({ relayUrl: "http://192.168.1.20:4000" })).toBe("http://192.168.1.20:4000");
  });
});
