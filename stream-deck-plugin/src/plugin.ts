import streamDeck from "@elgato/streamdeck";
import { ClockAction } from "./actions/clock.js";
import { ScoreAction } from "./actions/score.js";
import { PeriodAction } from "./actions/period.js";
import { relay } from "./relay.js";

streamDeck.actions.registerAction(new ClockAction());
streamDeck.actions.registerAction(new ScoreAction());
streamDeck.actions.registerAction(new PeriodAction());

streamDeck.settings.onDidReceiveGlobalSettings(async (ev) => {
  const settings = ev.settings as { relayUrl?: string; token?: string; matchId?: string | null };
  const { relayUrl, token, matchId } = settings;
  if (relayUrl && token) {
    try {
      await relay.init(relayUrl, token, matchId);
      streamDeck.logger.info(`[ScoreHub] connected to ${relayUrl}`);
    } catch (err) {
      streamDeck.logger.error(`[ScoreHub] relay init failed: ${err}`);
    }
  }
});

await streamDeck.connect();
await streamDeck.settings.getGlobalSettings();
