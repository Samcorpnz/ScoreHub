/**
 * src/electron/main.ts runs its whole setup as a side effect of being
 * imported (see `main().catch(...)` at the bottom of that file), so these
 * tests mock "electron" plus ../controller and ../ui/server, require the
 * module once per test via jest.isolateModulesAsync, and assert against the
 * fakes rather than calling exported functions (there are none to call).
 */

type MenuTemplateItem = {
  label?: string;
  type?: string;
  checked?: boolean;
  enabled?: boolean;
  click?: (menuItem: { checked: boolean }) => void | Promise<void>;
};

let windowOpenHandler: ((details: { url: string }) => unknown) | null = null;
const windowInstances: FakeBrowserWindow[] = [];
const trayInstances: FakeTray[] = [];
const appListeners: Record<string, Array<() => void>> = {};

class FakeBrowserWindow {
  static getAllWindows = jest.fn(() => windowInstances);
  loadURL = jest.fn().mockResolvedValue(undefined);
  show = jest.fn();
  hide = jest.fn();
  webContents = {
    setWindowOpenHandler: jest.fn((handler: (details: { url: string }) => unknown) => {
      windowOpenHandler = handler;
    }),
  };
  private handlers: Record<string, Array<(...args: any[]) => void>> = {};

  constructor(public opts: unknown) {
    windowInstances.push(this);
  }

  on(event: string, handler: (...args: any[]) => void) {
    (this.handlers[event] ??= []).push(handler);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const h of this.handlers[event] ?? []) h(...args);
  }
}

class FakeTray {
  setToolTip = jest.fn();
  setContextMenu = jest.fn();
  on = jest.fn();
  constructor(public icon: unknown) {
    trayInstances.push(this);
  }
}

const openExternal = jest.fn().mockResolvedValue(undefined);
const buildFromTemplate = jest.fn((template: MenuTemplateItem[]) => ({ __template: template }));

let loginItemSettings = { openAtLogin: false };
const setLoginItemSettings = jest.fn((settings: { openAtLogin: boolean }) => {
  loginItemSettings = settings;
});

const fakeApp = {
  whenReady: jest.fn().mockResolvedValue(undefined),
  getPath: jest.fn().mockReturnValue("/fake/userData"),
  getVersion: jest.fn().mockReturnValue("1.0.0"),
  getLoginItemSettings: jest.fn(() => loginItemSettings),
  setLoginItemSettings,
  quit: jest.fn(),
  on: jest.fn((event: string, handler: () => void) => {
    (appListeners[event] ??= []).push(handler);
  }),
};

jest.mock("electron", () => ({
  app: fakeApp,
  BrowserWindow: FakeBrowserWindow,
  Tray: FakeTray,
  Menu: { buildFromTemplate },
  nativeImage: { createFromPath: jest.fn() },
  shell: { openExternal },
}));

const fakeController = {
  status: "stopped" as string,
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
};
const ElectronBridgeControllerMock = jest.fn(() => fakeController);
jest.mock("../controller", () => ({ BridgeController: ElectronBridgeControllerMock }));

type FakeUpdateState = {
  currentVersion: string;
  status: string;
  latestVersion: string | null;
  downloadUrl: string | null;
  checkedAt: number | null;
};
let updateState: FakeUpdateState;
const updateCheck = jest.fn(async (_manual: boolean) => updateState);
const updateStart = jest.fn();
let updateOnChange: (() => void) | undefined;
const FakeUpdateChecker = jest.fn((opts: { onChange?: () => void }) => {
  updateOnChange = opts.onChange;
  return { getState: () => updateState, check: updateCheck, start: updateStart };
});
jest.mock("../updateChecker", () => ({ UpdateChecker: FakeUpdateChecker }));

const createUiServer = jest.fn();
jest.mock("../ui/server", () => ({ createUiServer }));

async function loadMain(): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    require("../electron/main");
    // Flush the microtask queue so the top-level `main().catch(...)` (which
    // awaits app.whenReady(), dynamic imports, and window/tray setup) settles
    // before assertions run.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  });
}

function getTrayMenuTemplate(): MenuTemplateItem[] {
  const lastCall = buildFromTemplate.mock.calls.at(-1);
  if (!lastCall) throw new Error("Menu.buildFromTemplate was never called");
  return lastCall[0] as MenuTemplateItem[];
}

describe("electron/main", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    windowInstances.length = 0;
    trayInstances.length = 0;
    for (const key of Object.keys(appListeners)) delete appListeners[key];
    loginItemSettings = { openAtLogin: false };
    fakeController.status = "stopped";
    delete process.env.CD_AUTOSTART;
    windowOpenHandler = null;
    updateState = {
      currentVersion: "1.0.0",
      status: "idle",
      latestVersion: null,
      downloadUrl: null,
      checkedAt: null,
    };
  });

  it("sets BRIDGE_CONFIG_DIR from app.getPath('userData') before the controller is imported", async () => {
    await loadMain();
    expect(fakeApp.getPath).toHaveBeenCalledWith("userData");
    expect(process.env.BRIDGE_CONFIG_DIR).toBe("/fake/userData");
  });

  it("starts the existing UI server and opens a window pointed at it", async () => {
    await loadMain();
    expect(ElectronBridgeControllerMock).toHaveBeenCalledTimes(1);
    expect(createUiServer).toHaveBeenCalledWith(fakeController, 4002, expect.anything());
    expect(windowInstances).toHaveLength(1);
    expect(windowInstances[0].loadURL).toHaveBeenCalledWith("http://localhost:4002");
  });

  it("creates a tray with a context menu", async () => {
    await loadMain();
    expect(trayInstances).toHaveLength(1);
    expect(trayInstances[0].setContextMenu).toHaveBeenCalled();
  });

  it("closing the window hides it instead of quitting", async () => {
    await loadMain();
    const win = windowInstances[0];
    const closeEvent = { preventDefault: jest.fn() };
    win.emit("close", closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalled();
    expect(win.hide).toHaveBeenCalled();
  });

  it("does not autostart the bridge by default", async () => {
    await loadMain();
    expect(fakeController.start).not.toHaveBeenCalled();
  });

  it("autostarts the bridge when CD_AUTOSTART=true", async () => {
    process.env.CD_AUTOSTART = "true";
    await loadMain();
    expect(fakeController.start).toHaveBeenCalledTimes(1);
  });

  it("tray menu offers Start bridge when stopped, and starting it rebuilds the menu", async () => {
    fakeController.status = "stopped";
    await loadMain();
    const template = getTrayMenuTemplate();
    const startItem = template.find((i) => i.label === "Start bridge");
    expect(startItem).toBeDefined();

    await startItem!.click!({ checked: false });
    expect(fakeController.start).toHaveBeenCalledTimes(1);
    expect(trayInstances[0].setContextMenu).toHaveBeenCalledTimes(2);
  });

  it("tray menu offers Stop bridge when running, and stopping it calls controller.stop", async () => {
    fakeController.status = "running";
    await loadMain();
    const template = getTrayMenuTemplate();
    const stopItem = template.find((i) => i.label === "Stop bridge");
    expect(stopItem).toBeDefined();

    await stopItem!.click!({ checked: false });
    expect(fakeController.stop).toHaveBeenCalledTimes(1);
  });

  it("Launch at login checkbox reflects current setting and toggling it calls setLoginItemSettings", async () => {
    loginItemSettings = { openAtLogin: true };
    await loadMain();
    const template = getTrayMenuTemplate();
    const loginItem = template.find((i) => i.label === "Launch at login");
    expect(loginItem?.checked).toBe(true);

    loginItem!.click!({ checked: false });
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });

  it("Quit sets isQuitting so a subsequent window close is not intercepted, and calls app.quit()", async () => {
    await loadMain();
    const template = getTrayMenuTemplate();
    const quitItem = template.find((i) => i.label === "Quit");

    quitItem!.click!({ checked: false });
    expect(fakeApp.quit).toHaveBeenCalledTimes(1);

    const win = windowInstances[0];
    const closeEvent = { preventDefault: jest.fn() };
    win.emit("close", closeEvent);
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("registers a before-quit handler that also sets isQuitting", async () => {
    await loadMain();
    expect(appListeners["before-quit"]).toBeDefined();
    appListeners["before-quit"][0]();

    const win = windowInstances[0];
    const closeEvent = { preventDefault: jest.fn() };
    win.emit("close", closeEvent);
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
  });

  describe("update notice (SA-112)", () => {
    it("starts the update checker with the app version", async () => {
      await loadMain();
      expect(FakeUpdateChecker).toHaveBeenCalledWith(expect.objectContaining({ currentVersion: "1.0.0" }));
      expect(updateStart).toHaveBeenCalledTimes(1);
    });

    it("shows the version and a Check for updates item, with no download item when up to date", async () => {
      await loadMain();
      const template = getTrayMenuTemplate();
      expect(template.find((i) => i.label === "ScoreHub Bridge v1.0.0")).toBeDefined();
      expect(template.find((i) => i.label === "Check for updates…")).toBeDefined();
      expect(template.some((i) => i.label?.startsWith("Update available"))).toBe(false);
    });

    it("offers a Download item that opens the download URL when an update is available", async () => {
      updateState = { ...updateState, status: "available", latestVersion: "1.1.0", downloadUrl: "https://downloads.scorehub.co.nz/mac" };
      await loadMain();
      const item = getTrayMenuTemplate().find((i) => i.label === "Update available: v1.1.0 — Download");
      expect(item).toBeDefined();
      item!.click!({ checked: false });
      expect(openExternal).toHaveBeenCalledWith("https://downloads.scorehub.co.nz/mac");
    });

    it("Check for updates runs a manual check and shows the up-to-date result", async () => {
      await loadMain();
      const item = getTrayMenuTemplate().find((i) => i.label === "Check for updates…");
      updateState = { ...updateState, status: "up-to-date", checkedAt: 1 };
      await item!.click!({ checked: false });
      expect(updateCheck).toHaveBeenCalledWith(true);
      expect(getTrayMenuTemplate().find((i) => i.label === "You're up to date (v1.0.0)")).toBeDefined();
    });

    it("Check for updates surfaces a failure", async () => {
      await loadMain();
      const item = getTrayMenuTemplate().find((i) => i.label === "Check for updates…");
      updateState = { ...updateState, status: "error" };
      await item!.click!({ checked: false });
      expect(
        getTrayMenuTemplate().find((i) => i.label === "Couldn't check for updates — try again later")
      ).toBeDefined();
    });

    it("rebuilds the tray menu when the checker state changes and disables the item while checking", async () => {
      await loadMain();
      const before = trayInstances[0].setContextMenu.mock.calls.length;
      updateState = { ...updateState, status: "checking" };
      updateOnChange!();
      expect(trayInstances[0].setContextMenu.mock.calls.length).toBe(before + 1);
      const item = getTrayMenuTemplate().find((i) => i.label === "Checking for updates…");
      expect(item?.enabled).toBe(false);
    });

    it("opens https links from the window in the browser and denies new Electron windows", async () => {
      await loadMain();
      expect(windowOpenHandler!({ url: "https://downloads.scorehub.co.nz/mac" })).toEqual({ action: "deny" });
      expect(openExternal).toHaveBeenCalledWith("https://downloads.scorehub.co.nz/mac");
      openExternal.mockClear();
      expect(windowOpenHandler!({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
      expect(openExternal).not.toHaveBeenCalled();
    });
  });
});
