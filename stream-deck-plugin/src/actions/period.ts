import {
  action,
  SingletonAction,
  type KeyAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
  type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import { relay } from "../relay.js";
import type { MatchState } from "../types.js";
import { periodTitle } from "../periodTitle.js";

interface PeriodSettings {
  direction?: "next" | "prev";
}

function toPeriod(raw: Record<string, unknown>): PeriodSettings {
  return { direction: raw.direction === "prev" ? "prev" : "next" };
}

@action({ UUID: "com.scorehub.sdplugin.period" })
export class PeriodAction extends SingletonAction {
  private unsubs = new Map<string, () => void>();

  onWillAppear(ev: WillAppearEvent): void {
    const id = ev.action.id;
    this.unsubs.get(id)?.();
    this.unsubs.set(
      id,
      relay.subscribe((state) =>
        this.render(ev.action as KeyAction, state, toPeriod(ev.payload.settings))
      )
    );
  }

  onWillDisappear(ev: WillDisappearEvent): void {
    this.unsubs.get(ev.action.id)?.();
    this.unsubs.delete(ev.action.id);
  }

  onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    const state = relay.getState();
    if (state) this.render(ev.action as KeyAction, state, toPeriod(ev.payload.settings));
  }

  private render(action: KeyAction, state: MatchState, settings: PeriodSettings): void {
    const dir = settings.direction ?? "next";
    action.setTitle(`${periodTitle(state)}\n${dir === "next" ? "▶" : "◀"}`);
  }

  async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const { direction = "next" } = toPeriod(ev.payload.settings);
    await relay.callAction(`period/${direction}`);
  }
}
