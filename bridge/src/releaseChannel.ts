/**
 * Which environment this build of the bridge belongs to (SA-255).
 *
 * `release-channel.json` is committed as "production". The bridge-release CI
 * pipeline rewrites it to "uat" (via scripts/set-release-channel.js) before
 * building a `bridge-uat-v*` tag, so a UAT installer defaults to the UAT relay
 * and only ever offers UAT pre-releases as updates — testers don't have to
 * hand-edit the relay address, and production installs never see UAT builds.
 */

import channelFile from "./release-channel.json";

export type ReleaseChannel = "production" | "uat";

export interface ChannelSettings {
  /** Relay the packaged app connects to by default. */
  relayUrl: string;
  /** Branded download redirect (the downloads/ Worker) for this channel. */
  downloadsBase: string;
  /** GitHub release tags for this channel start with this. */
  tagPrefix: string;
  /** UAT builds are published as GitHub pre-releases; production never is. */
  includePrerelease: boolean;
}

export const CHANNEL_SETTINGS: Record<ReleaseChannel, ChannelSettings> = {
  production: {
    relayUrl: "https://relay.scorehub.co.nz",
    downloadsBase: "https://downloads.scorehub.co.nz",
    tagPrefix: "bridge-v",
    includePrerelease: false,
  },
  uat: {
    relayUrl: "https://relay.uat.scorehub.co.nz",
    downloadsBase: "https://downloads.uat.scorehub.co.nz",
    tagPrefix: "bridge-uat-v",
    includePrerelease: true,
  },
};

export const RELEASE_CHANNEL: ReleaseChannel = channelFile.channel === "uat" ? "uat" : "production";

export const CHANNEL: ChannelSettings = CHANNEL_SETTINGS[RELEASE_CHANNEL];
