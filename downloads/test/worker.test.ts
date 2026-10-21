// Run with `npm test` (node --test; Node strips the TypeScript types itself).
// Kept outside src/ so the Worker's tsconfig, which has no Node types, skips it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRelease, type Env, type GitHubRelease } from "../src/worker.ts";

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
