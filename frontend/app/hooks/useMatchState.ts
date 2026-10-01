"use client";

import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { MatchState, DEFAULT_MATCH_STATE, CricketBallEvent, ScoreAdjustEvent, IndoorCricketWicketEvent } from "../types";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:4000";

// If a hardware input source is configured, the bridge should be pushing
// state updates continuously — no update within this window means the
// bridge's socket is up but its hardware feed has gone quiet (SA-67).
const FEED_STALE_MS = 8_000;
const FEED_STALE_CHECK_MS = 1_000;

// SA-56's failover SLA targets a sub-5s reconnect. A disconnect lasting much
// longer than that is no longer "mid-failover" — it's worth telling the
// operator explicitly rather than just showing the generic OFFLINE dot.
const RELAY_UNREACHABLE_MS = 10_000;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type ControllerStatus = "connecting" | "granted" | "conflict" | "revoked" | "viewer";

// How long to wait for the relay to resolve a requestControl before retrying
// — the grant/conflict decision is a single fire-and-forget emit server-side
// (relay/src/server.ts), so a lost packet or a race with another socket's
// disconnect cleanup on the same room can otherwise leave the client stuck
// with neither controllerGranted nor controllerConflict, indefinitely.
const CONTROL_REQUEST_RETRY_DELAYS_MS = [1_500, 3_000, 6_000];

// How often to re-measure the client/relay clock offset (NTP-style
// send/receive round trip). Recent samples are kept and the lowest-RTT one
// used, since RTT jitter is the main source of offset-estimation error.
const TIME_SYNC_INTERVAL_MS = 30_000;
const TIME_SYNC_SAMPLE_WINDOW = 5;

export function useMatchState(auth?: { secret: string; role: string }) {
  const [state, setState] = useState<MatchState>({ ...DEFAULT_MATCH_STATE });
  const [socketStatus, setStatus] = useState<ConnectionStatus>("connecting");
  // Set when the relay rejects a display connection for a bad/missing
  // displayToken (see DISPLAY_TOKEN_REQUIRED in relay/src/server.ts) — lets
  // display pages show a "get a fresh link" fallback instead of a blank
  // screen indistinguishable from a normal connection drop.
  const [unauthorized, setUnauthorized] = useState(false);
  const [feedStale, setFeedStale] = useState(false);
  const [relayUnreachable, setRelayUnreachable] = useState(false);
  const [controllerStatus, setControllerStatus] = useState<ControllerStatus>(
    auth?.role === "control" ? "connecting" : "viewer"
  );
  const socketRef = useRef<Socket | null>(null);
  // Only read while status === "connected", and the connect handler stamps it
  // first, so the initial value is never observed.
  const lastUpdateRef = useRef<number>(0);
  const disconnectedSinceRef = useRef<number | null>(null);
  // Best current estimate of (relay clock − local clock), in ms. Used to
  // timestamp operator click instants in server-clock terms so the relay's
  // clock anchor isn't inflated by click→relay network latency (see
  // resyncClock/applyManualUpdate on the relay).
  const clockOffsetMsRef = useRef<number>(0);
  const clockOffsetSamplesRef = useRef<{ offsetMs: number; rttMs: number }[]>([]);
  // Latest-value refs so socket/timer callbacks don't go stale. Refreshed
  // after each commit — callbacks only ever read them from event/timer
  // context, never during render.
  const stateRef = useRef(state);
  const controllerStatusRef = useRef(controllerStatus);
  useEffect(() => {
    stateRef.current = state;
    controllerStatusRef.current = controllerStatus;
  });
  const secret = auth?.secret;
  const role = auth?.role;
  // The control panel passes useControlToken()'s return value as `secret`,
  // which is "" until the token fetch resolves — an empty-but-defined secret
  // means "waiting for a token", not a dropped connection (see the effect
  // below), so it always reads as "connecting" regardless of socket state.
  const status: ConnectionStatus = secret === "" ? "connecting" : socketStatus;

  useEffect(() => {
    // The control panel passes useControlToken()'s return value directly as
    // `secret` — it starts as "" until the token fetch resolves (and stays
    // "" while a failed fetch retries with backoff, see useControlToken.ts).
    // An empty-but-defined secret is a real "not ready yet" state, distinct
    // from a viewer's `undefined` secret — connecting with it would just get
    // silently rejected at the relay's handshake (no orgId resolves from an
    // empty secret) and retried forever by socket.io's own reconnection
    // logic, masking the real "waiting for a token" state as "OFFLINE".
    if (secret === "") return;

    // Viewers/displays have no secret — scope them to an org via the page's
    // ?org= query param so multiple tenants on one relay stay isolated.
    // An optional &matchId= further scopes them to one specific match
    // instead of the org's singleton "default" match. &token= is the
    // per-match displayToken (see DISPLAY_TOKEN_REQUIRED) — required once
    // enforcement is on, harmlessly ignored by the relay until then.
    const params = secret === undefined && globalThis.window !== undefined
      ? new URLSearchParams(globalThis.location.search)
      : undefined;
    const orgId = params?.get("org") ?? undefined;
    const matchId = params?.get("matchId") ?? undefined;
    const token = params?.get("token") ?? undefined;

    let socketAuth:
      | { secret: string; role: string | undefined }
      | { orgId?: string; matchId?: string; token?: string }
      | Record<string, never>;
    if (secret !== undefined) {
      socketAuth = { secret, role };
    } else if (orgId || matchId) {
      socketAuth = { orgId, matchId, token };
    } else {
      socketAuth = {};
    }

    const socket = io(RELAY_URL, {
      auth: socketAuth,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
    });
    socketRef.current = socket;

    const controlRetryTimers: ReturnType<typeof setTimeout>[] = [];
    const clearControlRetries = () => {
      controlRetryTimers.forEach(clearTimeout);
      controlRetryTimers.length = 0;
    };

    const runTimeSync = () => {
      const t0 = Date.now();
      socket.emit("timeSync", { t0 });
    };
    socket.on("timeSyncResponse", (payload: { t0: number; serverNow: number }) => {
      const t1 = Date.now();
      const rttMs = t1 - payload.t0;
      const offsetMs = payload.serverNow - (payload.t0 + t1) / 2;
      const samples = clockOffsetSamplesRef.current;
      samples.push({ offsetMs, rttMs });
      if (samples.length > TIME_SYNC_SAMPLE_WINDOW) samples.shift();
      clockOffsetMsRef.current = samples.reduce((best, s) => (s.rttMs < best.rttMs ? s : best), samples[0]).offsetMs;
    });
    const timeSyncTimer = setInterval(runTimeSync, TIME_SYNC_INTERVAL_MS);

    socket.on("connect", () => {
      setStatus("connected");
      setUnauthorized(false);
      lastUpdateRef.current = Date.now();
      setFeedStale(false);
      disconnectedSinceRef.current = null;
      setRelayUnreachable(false);
      runTimeSync();

      if (role === "control") {
        setControllerStatus("connecting");
        clearControlRetries();
        const requestControl = () => {
          socket.timeout(3000).emit("requestControl", (err: Error | null, result?: "granted" | "conflict") => {
            // resolveController on the relay has already emitted
            // controllerGranted/controllerConflict by this point — those
            // listeners are the primary path. This ack is a second,
            // delivery-guaranteed channel for the same outcome (the relay's
            // response to this specific request, not a broadcast that could
            // in principle go astray), so act on it directly too rather than
            // relying solely on the broadcast having arrived.
            if (err || !result) return; // timed out — the scheduled retry below will try again
            clearControlRetries();
            setControllerStatus(result === "granted" ? "granted" : "conflict");
          });
        };
        requestControl();
        CONTROL_REQUEST_RETRY_DELAYS_MS.forEach(delay => {
          controlRetryTimers.push(setTimeout(() => {
            if (controllerStatusRef.current !== "connecting") return;
            requestControl();
          }, delay));
        });
      }
    });
    socket.on("disconnect", () => {
      setStatus("disconnected");
      setFeedStale(false);
      disconnectedSinceRef.current ??= Date.now();
    });
    socket.on("connect_error", (err: Error) => {
      setStatus("disconnected");
      setFeedStale(false);
      disconnectedSinceRef.current ??= Date.now();
      if (/display token/i.test(err.message)) setUnauthorized(true);
    });

    socket.on("matchStateChange", (incoming: MatchState) => {
      lastUpdateRef.current = Date.now();
      setFeedStale(false);
      setState(prev =>
        incoming.sequenceId >= prev.sequenceId ? incoming : prev
      );
    });

    socket.on("controllerGranted", () => { clearControlRetries(); setControllerStatus("granted"); });
    socket.on("controllerConflict", () => { clearControlRetries(); setControllerStatus("conflict"); });
    socket.on("controllerRevoked",  () => setControllerStatus("revoked"));

    return () => { clearControlRetries(); clearInterval(timeSyncTimer); socket.disconnect(); };
  }, [secret, role]);

  useEffect(() => {
    const interval = setInterval(() => {
      const shouldBeStale =
        status === "connected" &&
        stateRef.current.inputSource !== "none" &&
        Date.now() - lastUpdateRef.current >= FEED_STALE_MS;
      setFeedStale(shouldBeStale);

      const shouldBeUnreachable =
        status === "disconnected" &&
        disconnectedSinceRef.current !== null &&
        Date.now() - disconnectedSinceRef.current >= RELAY_UNREACHABLE_MS;
      setRelayUnreachable(shouldBeUnreachable);
    }, FEED_STALE_CHECK_MS);
    return () => clearInterval(interval);
  }, [status]);

  // Resolves once the relay has actually applied the patch (or after a
  // timeout/error) — callers that navigate right after sending an update
  // (e.g. the /setup wizard routing into /control) must await this, or the
  // navigation can unmount this hook and disconnect the socket before the
  // fire-and-forget emit ever reaches the relay, silently dropping the patch.
  const sendManualUpdate = (patch: Partial<MatchState> & { clientEventMs?: number }): Promise<void> => {
    return new Promise(resolve => {
      const socket = socketRef.current;
      if (!socket) { resolve(); return; }
      socket.timeout(3000).emit("manualUpdate", patch, () => resolve());
    });
  };

  // Estimated current relay-clock time, in this client's best current
  // estimate — use to timestamp an operator's click instant (e.g. Start/Stop)
  // before the network round-trip to the relay, so the clock anchor it sets
  // reflects the moment of the click rather than the moment the relay
  // happened to receive it.
  const estimateServerNow = () => Date.now() + clockOffsetMsRef.current;

  const sendReset = () => {
    socketRef.current?.emit("resetMatch");
  };

  const sendUndo = () => {
    socketRef.current?.emit("undo");
  };

  const takeControl = () => {
    socketRef.current?.emit("takeControl");
  };

  const sendCricketBall = (payload: CricketBallEvent) => {
    socketRef.current?.emit("cricket:ball", payload);
  };

  const sendCricketOverComplete = (payload: { nextBowlerIndex?: number }) => {
    socketRef.current?.emit("cricket:overComplete", payload);
  };

  const sendCricketInningsChange = (payload: { battingTeam: "home" | "visitor"; target?: number }) => {
    socketRef.current?.emit("cricket:inningsChange", payload);
  };

  const sendCricketDeclare = (payload: { battingTeam: "home" | "visitor" }) => {
    socketRef.current?.emit("cricket:declare", payload);
  };

  const sendScoreAdjust = (payload: ScoreAdjustEvent) => {
    socketRef.current?.emit("adjustScore", payload);
  };

  const sendIndoorCricketWicket = (payload: IndoorCricketWicketEvent) => {
    socketRef.current?.emit("indoorCricket:wicket", payload);
  };

  return {
    state, status, feedStale, relayUnreachable, unauthorized, sendManualUpdate, sendReset, sendUndo, controllerStatus, takeControl,
    sendCricketBall, sendCricketOverComplete, sendCricketInningsChange, sendCricketDeclare,
    sendScoreAdjust, sendIndoorCricketWicket, estimateServerNow,
  };
}
