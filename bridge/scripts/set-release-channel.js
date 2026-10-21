#!/usr/bin/env node
/**
 * Turns this checkout into a UAT build before `npm run dist:*` (SA-255).
 * Run by .github/workflows/bridge-release.yml for `bridge-uat-v*` tags only;
 * it edits files in place, so don't commit the result.
 *
 *   node scripts/set-release-channel.js uat 0.3.2-rc.1
 *
 * - src/release-channel.json → "uat" (relay, downloads and update feed; see
 *   src/releaseChannel.ts)
 * - package.json version → the tag's version, so the installer filename and
 *   app.getVersion() match the pre-release
 * - a separate appId and productName, so the UAT app installs alongside the
 *   production one and keeps its own bridge-config.json (Electron's userData
 *   directory is named after the product)
 */

const fs = require("node:fs");
const path = require("node:path");

const [channel, version] = process.argv.slice(2);
if (channel !== "uat" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  console.error("Usage: node scripts/set-release-channel.js uat <version>, e.g. uat 0.3.2-rc.1");
  process.exit(1);
}

const root = path.join(__dirname, "..");

fs.writeFileSync(path.join(root, "src/release-channel.json"), JSON.stringify({ channel }) + "\n");

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = version;
pkg.productName = "ScoreHub Bridge UAT";
pkg.build.appId = "co.nz.scorehub.bridge.uat";
pkg.build.productName = "ScoreHub Bridge UAT";
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Configured a ${channel} build, version ${version}`);
