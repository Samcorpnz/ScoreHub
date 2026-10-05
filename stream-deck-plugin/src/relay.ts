import { io, Socket } from "socket.io-client";
import type { MatchState } from "./types.js";

type Listener = (state: MatchState) => void;

// A type alias (not an interface) so it's assignable to the SDK's JsonValue
export type MatchOption = {
  id: string;
  name: string;
  status: string;
};

interface MatchList {
  orgId: string;
  pinnedMatchId: string | null;
  matches: (MatchOption & { displayToken?: string | null })[];
}

const MATCH_LIST_TIMEOUT_MS = 5_000;

// The relay URL is typed in by the user, so every request built from it goes
// through here: http(s) only, no embedded credentials, and only the origin
// is kept — the path is always ours.
function relayOrigin(relayUrl: string): string {
  let url: URL;
  try {
    url = new URL(relayUrl);
  } catch {
    throw new Error("Relay URL isn't a valid URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Relay URL must be a plain http or https address");
  }
  return url.origin;
}

async function fetchMatchList(relayUrl: string, token: string): Promise<MatchList> {
  const res = await fetch(`${relayOrigin(relayUrl)}/api/matches`, {
    headers: { "x-control-secret": token },
    redirect: "error",
    signal: AbortSignal.timeout(MATCH_LIST_TIMEOUT_MS),
  });
  if (res.status === 401) throw new Error("Control token not recognised");
  if (!res.ok) throw new Error(`Relay returned ${res.status}`);
  const body = (await res.json()) as Partial<MatchList>;
  if (typeof body.orgId !== "string" || !Array.isArray(body.matches)) throw new Error("Unexpected response from the relay");
  return { orgId: body.orgId, pinnedMatchId: body.pinnedMatchId ?? null, matches: body.matches };
}

class RelayClient {
  private socket: Socket | null = null;
  private state: MatchState | null = null;
  private listeners = new Set<Listener>();
  private orgId: string | null = null;
  private matchId: string | undefined;
  private displayToken: string | undefined;

  relayUrl = "";
  token = "";

  // Called when global settings are saved in the PI. Resolves which match
  // the keys act on, then opens a viewer socket for live state updates.
  //
  // A token pinned to a match always uses that match. Otherwise the match
  // chosen in the PI's picker is used — without one the keys would act on
  // the organisation's default match, which isn't the one a match's
  // displays and control panel are showing.
  async init(relayUrl: string, token: string, selectedMatchId?: string | null): Promise<void> {
    this.relayUrl = relayOrigin(relayUrl);
    this.token = token;

    const { orgId, pinnedMatchId, matches } = await fetchMatchList(this.relayUrl, token);
    this.orgId = orgId;
    this.matchId = pinnedMatchId ?? selectedMatchId ?? undefined;
    this.displayToken = matches.find((m) => m.id === this.matchId)?.displayToken ?? undefined;
    this.state = null;
    this.connect();
  }

  // For the property inspector's match picker. The inspector asks the plugin
  // rather than calling the relay itself, so the user-entered URL is only
  // ever requested from here, and the inspector never sees display tokens.
  async listMatches(relayUrl: string, token: string): Promise<{ orgId: string; pinnedMatchId: string | null; matches: MatchOption[] }> {
    const { orgId, pinnedMatchId, matches } = await fetchMatchList(relayUrl, token);
    return {
      orgId,
      pinnedMatchId,
      matches: matches.slice(0, 100).map((m) => ({ id: String(m.id), name: String(m.name), status: String(m.status) })),
    };
  }

  private connect(): void {
    this.socket?.disconnect();
    if (!this.orgId) return;

    this.socket = io(this.relayUrl, {
      auth: { orgId: this.orgId, matchId: this.matchId, token: this.displayToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on("matchStateChange", (incoming: MatchState) => {
      this.state = incoming;
      for (const fn of this.listeners) fn(incoming);
    });
  }

  // Returns an unsubscribe function. Immediately calls the listener with the
  // last known state so buttons render without waiting for the next update.
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.state) fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): MatchState | null {
    return this.state;
  }

  // HTTP POST to a relay action endpoint, authenticated with the CONTROL token.
  async callAction(path: string, params: Record<string, string | number> = {}): Promise<void> {
    if (!this.relayUrl || !this.token) return;
    const url = new URL(`${this.relayUrl}/action/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    if (this.matchId) url.searchParams.set("matchId", this.matchId);
    await fetch(url.toString(), {
      method: "POST",
      headers: { "x-control-secret": this.token },
    });
  }
}

export const relay = new RelayClient();
