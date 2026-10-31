/**
 * downloads.scorehub.co.nz — branded redirect to the latest Bridge desktop
 * installer, published as a GitHub Release asset by the bridge-release CI
 * pipeline (SA-91). No installers are stored here; this Worker just resolves
 * "latest .dmg" / "latest .exe" and 302s to the real github.com URL, so the
 * control panel and help site can link to a stable, branded address instead
 * of a raw releases URL that changes with every version.
 *
 * The `uat` environment (downloads.uat.scorehub.co.nz, SA-255) serves UAT
 * builds instead: `bridge-uat-v*` tags, which are published as pre-releases,
 * so it sets INCLUDE_PRERELEASE. Production leaves it unset and never serves a
 * pre-release.
 */

export interface Env {
  GITHUB_REPO: string; // "Samcorpnz/ScoringApp"
  RELEASE_TAG_PREFIX: string; // "bridge-v"
  INCLUDE_PRERELEASE?: string; // "true" to serve pre-releases (UAT only)
  GITHUB_TOKEN?: string; // Worker secret; read-only, for GitHub's per-token rate limit
}

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubAsset[];
}

const CACHE_TTL_SECONDS = 300;
const LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The parts of the runtime the release lookup needs, injectable for tests. */
export interface LookupDeps {
  fetch: typeof fetch;
  cache: Pick<Cache, "match" | "put">;
}

type Platform = "mac" | "mac-intel" | "windows";

export function matchAsset(assets: GitHubAsset[], platform: Platform): GitHubAsset | undefined {
  const names = assets.map((asset) => ({ asset, name: asset.name.toLowerCase() }));
  if (platform === "windows") return names.find(({ name }) => name.endsWith(".exe"))?.asset;
  // electron-builder marks only the Apple Silicon .dmg with its arch.
  const wantArm = platform === "mac";
  return names.find(({ name }) => name.endsWith(".dmg") && name.includes("arm64") === wantArm)?.asset;
}

function lastGoodKey(env: Env): string {
  return `https://downloads.internal/last-good/${env.RELEASE_TAG_PREFIX}`;
}

/**
 * The newest matching release. GitHub's unauthenticated limit is shared across
 * Cloudflare's egress IPs, so without GITHUB_TOKEN a 403 here is routine rather
 * than an outage: when the lookup fails, this answers from the last release it saw. It only throws
 * when there is no such release to fall back on.
 */
export async function findLatestBridgeRelease(env: Env, deps: LookupDeps): Promise<GitHubRelease | undefined> {
  try {
    const response = await deps.fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/releases`, {
      headers: {
        "User-Agent": "scorehub-downloads-worker",
        Accept: "application/vnd.github+json",
        ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      },
      // By status: a plain cacheTtl would also hold a 403 for the full five minutes.
      cf: { cacheTtlByStatus: { "200-299": CACHE_TTL_SECONDS, "400-599": 0 }, cacheEverything: true },
    });

    if (!response.ok) {
      throw new Error(`GitHub releases lookup failed: ${response.status}`);
    }

    const releases = (await response.json()) as GitHubRelease[];
    const release = pickRelease(releases, env);
    if (release) {
      await deps.cache
        .put(
          lastGoodKey(env),
          new Response(JSON.stringify(release), {
            headers: { "Cache-Control": `max-age=${LAST_GOOD_TTL_SECONDS}` },
          })
        )
        .catch((err) => console.error("Could not store the last good release:", err));
    }
    return release;
  } catch (err) {
    const lastGood = await deps.cache.match(lastGoodKey(env));
    if (!lastGood) throw err;
    console.warn(`Serving the last good release: ${String(err)}`);
    return (await lastGood.json()) as GitHubRelease;
  }
}

/** The first (newest-created) published release with the channel's tag prefix. */
export function pickRelease(releases: GitHubRelease[], env: Env): GitHubRelease | undefined {
  const includePrerelease = env.INCLUDE_PRERELEASE === "true";
  return releases.find(
    (release) =>
      !release.draft &&
      (includePrerelease || !release.prerelease) &&
      release.tag_name.startsWith(env.RELEASE_TAG_PREFIX)
  );
}

function detectPlatform(userAgent: string | null): Platform {
  if (userAgent && /mac ?os|macintosh/i.test(userAgent)) return "mac";
  return "windows";
}

function notFound(message: string): Response {
  return new Response(message, { status: 404, headers: { "content-type": "text/plain" } });
}

async function handleDownload(platform: Platform, env: Env): Promise<Response> {
  let release: GitHubRelease | undefined;
  try {
    release = await findLatestBridgeRelease(env, { fetch, cache: caches.default });
  } catch (err) {
    console.error(`No release to serve, sending to the releases page: ${String(err)}`);
    return Response.redirect(`https://github.com/${env.GITHUB_REPO}/releases`, 302);
  }

  if (!release) {
    return notFound(
      "No Bridge installer has been published yet. Check back soon, or see " +
        "https://help.scorehub.co.nz/connecting-the-bridge for manual setup instructions."
    );
  }

  const asset = matchAsset(release.assets, platform);
  if (!asset) {
    return notFound(`No ${platform} installer found in release ${release.tag_name}.`);
  }

  return Response.redirect(asset.browser_download_url, 302);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mac") return handleDownload("mac", env);
    if (url.pathname === "/mac-intel") return handleDownload("mac-intel", env);
    if (url.pathname === "/windows") return handleDownload("windows", env);

    if (url.pathname === "/" || url.pathname === "") {
      return handleDownload(detectPlatform(request.headers.get("user-agent")), env);
    }

    return notFound("Not found. Try /mac, /mac-intel or /windows.");
  },
};
