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

// The property inspector asks for the match list here instead of calling the
// relay from its own page. It passes the URL and token from the form when the
// user selects Connect (they aren't saved yet); otherwise the saved ones apply.
streamDeck.ui.onSendToPlugin(async (ev) => {
  const payload = ev.payload as { type?: string; relayUrl?: string; token?: string } | null;
  if (payload?.type !== "listMatches") return;
  try {
    const list = await relay.listMatches(payload.relayUrl || relay.relayUrl, payload.token || relay.token);
    await streamDeck.ui.sendToPropertyInspector({ type: "matches", ok: true, ...list });
  } catch (err) {
    await streamDeck.ui.sendToPropertyInspector({ type: "matches", ok: false, error: err instanceof Error ? err.message : "Failed" });
  }
});

await streamDeck.connect();
await streamDeck.settings.getGlobalSettings();
