import { UpdateChecker, downloadUrlForPlatform, isNewerVersion, parseVersion } from "../updateChecker";

type Release = { tag_name: string; draft?: boolean; prerelease?: boolean };

function fakeFetch(releases: Release[] | Error | { status: number }) {
  return jest.fn(async () => {
    if (releases instanceof Error) throw releases;
    if (!Array.isArray(releases)) return { ok: false, status: releases.status, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => releases.map((r) => ({ draft: false, prerelease: false, ...r })),
    };
  }) as unknown as typeof fetch & jest.Mock;
}

function makeChecker(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof UpdateChecker>[0]> = {}) {
  return new UpdateChecker({ currentVersion: "1.0.0", platform: "darwin", fetchImpl, ...extra });
}

describe("version helpers", () => {
  it("parses plain, v-prefixed and suffixed versions", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2.3-beta.1")).toEqual([1, 2, 3]);
  });

  it("rejects non-semver strings", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });

  it("compares numerically, not lexically", () => {
    expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true);
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("garbage", "1.0.0")).toBe(false);
  });

  it("maps platform to download URL", () => {
    expect(downloadUrlForPlatform("darwin")).toBe("https://downloads.scorehub.co.nz/mac");
    expect(downloadUrlForPlatform("win32")).toBe("https://downloads.scorehub.co.nz/windows");
    expect(downloadUrlForPlatform("linux")).toBe("https://downloads.scorehub.co.nz/");
  });
});

describe("UpdateChecker", () => {
  it("reports an available update from the newest bridge-v release", async () => {
    const checker = makeChecker(fakeFetch([{ tag_name: "bridge-v1.1.0" }, { tag_name: "bridge-v1.0.0" }]));
    const state = await checker.check(false);
    expect(state).toMatchObject({
      status: "available",
      latestVersion: "1.1.0",
      downloadUrl: "https://downloads.scorehub.co.nz/mac",
    });
  });

  it("picks the highest version even when listed out of order", async () => {
    const checker = makeChecker(fakeFetch([{ tag_name: "bridge-v1.0.5" }, { tag_name: "bridge-v1.2.0" }]));
    expect((await checker.check(false)).latestVersion).toBe("1.2.0");
  });

  it("ignores drafts, prereleases, other tag prefixes and non-semver tags", async () => {
    const checker = makeChecker(
      fakeFetch([
        { tag_name: "bridge-v9.0.0", draft: true },
        { tag_name: "bridge-v8.0.0", prerelease: true },
        { tag_name: "v7.0.0" },
        { tag_name: "bridge-vnext" },
      ])
    );
    expect((await checker.check(false)).status).toBe("up-to-date");
  });

  it("is up to date when the latest release equals or trails the current version", async () => {
    const checker = makeChecker(fakeFetch([{ tag_name: "bridge-v1.0.0" }]));
    expect(await checker.check(false)).toMatchObject({ status: "up-to-date", latestVersion: null, downloadUrl: null });
  });

  it("is up to date when no bridge release exists", async () => {
    const checker = makeChecker(fakeFetch([]));
    expect((await checker.check(false)).status).toBe("up-to-date");
  });

  it("automatic checks swallow failures and keep prior state", async () => {
    for (const failure of [new Error("offline"), { status: 403 }]) {
      const checker = makeChecker(fakeFetch(failure));
      const state = await checker.check(false);
      expect(state.status).toBe("idle");
    }
  });

  it("manual checks surface failures as error", async () => {
    const checker = makeChecker(fakeFetch(new Error("offline")));
    expect((await checker.check(true)).status).toBe("error");
  });

  it("manual failure does not discard a previously found update's version", async () => {
    let fail = false;
    const fetchImpl = jest.fn(async () => {
      if (fail) throw new Error("offline");
      return { ok: true, status: 200, json: async () => [{ tag_name: "bridge-v2.0.0", draft: false, prerelease: false }] };
    }) as unknown as typeof fetch;
    let t = 0;
    const checker = makeChecker(fetchImpl, { now: () => (t += 60_000) });
    await checker.check(false);
    fail = true;
    const state = await checker.check(true);
    expect(state.status).toBe("error");
    expect(state.latestVersion).toBe("2.0.0");
  });

  it("emits checking then the result on manual checks", async () => {
    const statuses: string[] = [];
    const checker = makeChecker(fakeFetch([{ tag_name: "bridge-v1.0.0" }]), {
      onChange: (s) => statuses.push(s.status),
    });
    await checker.check(true);
    expect(statuses).toEqual(["checking", "up-to-date"]);
  });

  it("debounces repeat manual checks but not automatic ones", async () => {
    const fetchImpl = fakeFetch([{ tag_name: "bridge-v1.0.0" }]);
    let t = 1000;
    const checker = makeChecker(fetchImpl, { now: () => t });
    await checker.check(true);
    t += 2000;
    await checker.check(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await checker.check(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    t += 20_000;
    await checker.check(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not debounce a manual retry after a failed check", async () => {
    const fetchImpl = fakeFetch(new Error("offline"));
    const checker = makeChecker(fetchImpl);
    await checker.check(true);
    await checker.check(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent checks", async () => {
    const fetchImpl = fakeFetch([{ tag_name: "bridge-v1.0.0" }]);
    const checker = makeChecker(fetchImpl);
    await Promise.all([checker.check(true), checker.check(false)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  describe("scheduling", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("checks on start and then on every interval until stopped", async () => {
      const fetchImpl = fakeFetch([{ tag_name: "bridge-v1.0.0" }]);
      const checker = makeChecker(fetchImpl, { checkIntervalMs: 1000 });
      checker.start();
      checker.start(); // idempotent
      await jest.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      checker.stop();
      await jest.advanceTimersByTimeAsync(5000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });
});
