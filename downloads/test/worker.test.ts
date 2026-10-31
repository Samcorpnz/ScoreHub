// Run with `npm test` (node --test; Node strips the TypeScript types itself).
// Kept outside src/ so the Worker's tsconfig, which has no Node types, skips it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findLatestBridgeRelease, matchAsset, pickRelease, type Env, type GitHubRelease, type LookupDeps } from "../src/worker.ts";

const production: Env = { GITHUB_REPO: "Samcorpnz/ScoreHub", RELEASE_TAG_PREFIX: "bridge-v" };
const uat: Env = {
  GITHUB_REPO: "Samcorpnz/ScoreHub",
  RELEASE_TAG_PREFIX: "bridge-uat-v",
  INCLUDE_PRERELEASE: "true",
};

function release(tag_name: string, extra: Partial<GitHubRelease> = {}): GitHubRelease {
  return { tag_name, draft: false, prerelease: false, assets: [], ...extra };
}

// GitHub lists releases newest-created first.
const releases = [
  release("bridge-uat-v0.4.0-rc.2", { draft: true }),
  release("bridge-uat-v0.4.0-rc.1", { prerelease: true }),
  release("bridge-v0.4.0-beta.1", { prerelease: true }),
  release("bridge-v0.3.1"),
  release("bridge-v0.3.0"),
];

test("production serves the newest non-pre-release bridge-v release", () => {
  assert.equal(pickRelease(releases, production)?.tag_name, "bridge-v0.3.1");
});

test("production never serves a UAT build, even one not flagged as a pre-release", () => {
  const onlyUat = [release("bridge-uat-v0.5.0"), release("bridge-uat-v0.4.0-rc.1", { prerelease: true })];
  assert.equal(pickRelease(onlyUat, production), undefined);
});

test("UAT serves the newest UAT pre-release and skips drafts", () => {
  assert.equal(pickRelease(releases, uat)?.tag_name, "bridge-uat-v0.4.0-rc.1");
});

test("UAT never serves a production release", () => {
  assert.equal(pickRelease([release("bridge-v0.3.1")], uat), undefined);
});

function fakeCache(): LookupDeps["cache"] {
  const store = new Map<string, string>();
  return {
    async match(key) {
      const body = store.get(String(key));
      return body === undefined ? undefined : new Response(body);
    },
    async put(key, response) {
      store.set(String(key), await response.text());
    },
  };
}

function githubReturning(status: number, body: unknown = []): LookupDeps["fetch"] {
  return async () => new Response(JSON.stringify(body), { status });
}

test("a failed lookup falls back to the last good release", async () => {
  const cache = fakeCache();
  await findLatestBridgeRelease(production, { fetch: githubReturning(200, releases), cache });
  const fallback = await findLatestBridgeRelease(production, { fetch: githubReturning(403), cache });
  assert.equal(fallback?.tag_name, "bridge-v0.3.1");
});

test("a network error falls back to the last good release too", async () => {
  const cache = fakeCache();
  await findLatestBridgeRelease(production, { fetch: githubReturning(200, releases), cache });
  const offline: LookupDeps["fetch"] = async () => {
    throw new Error("connection reset");
  };
  assert.equal((await findLatestBridgeRelease(production, { fetch: offline, cache }))?.tag_name, "bridge-v0.3.1");
});

test("a failed lookup with nothing to fall back on throws", async () => {
  await assert.rejects(
    findLatestBridgeRelease(production, { fetch: githubReturning(403), cache: fakeCache() }),
    /lookup failed: 403/
  );
});

test("each channel keeps its own last good release", async () => {
  const cache = fakeCache();
  await findLatestBridgeRelease(production, { fetch: githubReturning(200, releases), cache });
  await assert.rejects(findLatestBridgeRelease(uat, { fetch: githubReturning(403), cache }), /lookup failed: 403/);
});

test("a failed cache write does not fail the download", async () => {
  const cache = fakeCache();
  cache.put = async () => {
    throw new Error("cache unavailable");
  };
  const release = await findLatestBridgeRelease(production, { fetch: githubReturning(200, releases), cache });
  assert.equal(release?.tag_name, "bridge-v0.3.1");
});

test("the lookup sends GITHUB_TOKEN when it is set, and no auth header otherwise", async () => {
  const seen: (string | null)[] = [];
  const recording: LookupDeps["fetch"] = async (_url, init) => {
    seen.push(new Headers(init?.headers).get("Authorization"));
    return new Response(JSON.stringify(releases));
  };
  await findLatestBridgeRelease(production, { fetch: recording, cache: fakeCache() });
  await findLatestBridgeRelease({ ...production, GITHUB_TOKEN: "t" }, { fetch: recording, cache: fakeCache() });
  assert.deepEqual(seen, [null, "Bearer t"]);
});

test("each platform gets its own installer, whatever order GitHub lists them in", () => {
  const names = ["ScoreHub.Bridge-0.3.1-arm64.dmg", "ScoreHub.Bridge-0.3.1.dmg", "ScoreHub.Bridge.Setup.0.3.1.exe"];
  const assets = names.map((name) => ({ name, browser_download_url: `https://example.test/${name}` }));
  for (const list of [assets, [...assets].reverse()]) {
    assert.equal(matchAsset(list, "mac")?.name, "ScoreHub.Bridge-0.3.1-arm64.dmg");
    assert.equal(matchAsset(list, "mac-intel")?.name, "ScoreHub.Bridge-0.3.1.dmg");
    assert.equal(matchAsset(list, "windows")?.name, "ScoreHub.Bridge.Setup.0.3.1.exe");
  }
});
