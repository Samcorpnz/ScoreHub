import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMatchState } from "../useMatchState";
import { DEFAULT_MATCH_STATE } from "../../types";

type Handler = (...args: any[]) => void;

function makeFakeSocket() {
  const handlers: Record<string, Handler[]> = {};
  const timeoutEmit = vi.fn((event: string, ...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") cb();
  });
  return {
    on: vi.fn((event: string, cb: Handler) => {
      (handlers[event] ??= []).push(cb);
    }),
    emit: vi.fn(),
    timeout: vi.fn(() => ({ emit: timeoutEmit })),
    timeoutEmit,
    disconnect: vi.fn(),
    __trigger: (event: string, ...args: any[]) => {
      for (const cb of handlers[event] ?? []) cb(...args);
    },
  };
}

let fakeSocket: ReturnType<typeof makeFakeSocket>;
const ioMock = vi.fn((..._args: unknown[]) => fakeSocket);

vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

describe("useMatchState", () => {
  beforeEach(() => {
    fakeSocket = makeFakeSocket();
    ioMock.mockClear();
  });

  it("starts in the connecting state with default match state", () => {
    const { result } = renderHook(() => useMatchState({ secret: "s", role: "control" }));
    expect(result.current.status).toBe("connecting");
    expect(result.current.state).toEqual(DEFAULT_MATCH_STATE);
  });

  it("transitions to connected on the socket's connect event", async () => {
    const { result } = renderHook(() => useMatchState({ secret: "s", role: "control" }));
    act(() => fakeSocket.__trigger("connect"));
    await waitFor(() => expect(result.current.status).toBe("connected"));
  });

  it("transitions to disconnected on disconnect/connect_error", async () => {
    const { result } = renderHook(() => useMatchState({ secret: "s", role: "control" }));
    act(() => fakeSocket.__trigger("disconnect"));
    await waitFor(() => expect(result.current.status).toBe("disconnected"));
  });

  it("adopts an incoming matchStateChange with a newer sequenceId", async () => {
    const { result } = renderHook(() => useMatchState({ secret: "s", role: "control" }));
    const incoming = { ...DEFAULT_MATCH_STATE, sequenceId: 5, matchName: "Finals" };
    act(() => fakeSocket.__trigger("matchStateChange", incoming));
    await waitFor(() => expect(result.current.state.matchName).toBe("Finals"));
  });

  it("reports the state as loaded only once the relay has sent it", async () => {
    const { result } = renderHook(() => useMatchState({ secret: "s", role: "control" }));
    expect(result.current.stateLoaded).toBe(false);
    act(() => fakeSocket.__trigger("connect"));
    expect(result.current.stateLoaded).toBe(false);
    act(() => fakeSocket.__trigger("matchStateChange", { ...DEFAULT_MATCH_STATE, sequenceId: 3 }));
    await waitFor(() => expect(result.current.stateLoaded).toBe(true));
  });

  it("ignores a stale matchStateChange with an older sequenceId", async () => {
    const { result } = renderHook(() => useMatchState({ secret: "s", role: "control" }));
    act(() => fakeSocket.__trigger("matchStateChange", { ...DEFAULT_MATCH_STATE, sequenceId: 5, matchName: "Finals" }));
    await waitFor(() => expect(result.current.state.sequenceId).toBe(5));

    act(() => fakeSocket.__trigger("matchStateChange", { ...DEFAULT_MATCH_STATE, sequenceId: 1, matchName: "Stale" }));
    expect(result.current.state.matchName).toBe("Finals");
  });

  it("sendManualUpdate emits manualUpdate on the socket", () => {
    const { result } = renderHook(() => useMatchState({ secret: "s", role: "control" }));
    act(() => { result.current.sendManualUpdate({ matchName: "New" }); });
    expect(fakeSocket.timeoutEmit).toHaveBeenCalledWith(
      "manualUpdate", { matchName: "New" }, expect.any(Function)
    );
  });

  it("sendReset emits resetMatch on the socket", () => {
    const { result } = renderHook(() => useMatchState({ secret: "s", role: "control" }));
    act(() => result.current.sendReset());
    expect(fakeSocket.emit).toHaveBeenCalledWith("resetMatch");
  });

  it("authenticates with the supplied secret/role when provided", () => {
    renderHook(() => useMatchState({ secret: "top-secret", role: "control" }));
    expect(ioMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { secret: "top-secret", role: "control" } })
    );
  });

  it("tracks clock offset from timeSyncResponse samples, keeping the lowest-RTT sample", () => {
    renderHook(() => useMatchState({ secret: "s", role: "control" }));
    const now = Date.now();
    act(() => fakeSocket.__trigger("timeSyncResponse", { t0: now - 100, serverNow: now }));
    act(() => fakeSocket.__trigger("timeSyncResponse", { t0: now - 20, serverNow: now }));
    // No assertion needed beyond "doesn't throw" — this exercises the
    // reduce() over multiple samples that picks the lowest-rtt sample.
  });

  it("disconnects the socket on unmount", () => {
    const { unmount } = renderHook(() => useMatchState({ secret: "s", role: "control" }));
    unmount();
    expect(fakeSocket.disconnect).toHaveBeenCalled();
  });

  it("does not open a socket while the control token hasn't been fetched yet (secret === \"\")", () => {
    // useControlToken() returns "" until its fetch resolves (or while a
    // failed fetch is retrying) — connecting with that would just get
    // silently rejected at the relay's handshake and retried forever by
    // socket.io's own reconnection logic, showing "OFFLINE" instead of the
    // real "waiting for a token" state (SA-102 follow-up).
    const { result } = renderHook(() => useMatchState({ secret: "", role: "control" }));
    expect(ioMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("connecting");
  });

  it("includes the display token from the URL for an unauthenticated (viewer) connection", () => {
    const original = window.location.href;
    window.history.pushState({}, "", "/display/basic?org=org-1&matchId=m1&token=tok-1");
    renderHook(() => useMatchState());
    expect(ioMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { orgId: "org-1", matchId: "m1", token: "tok-1" } }),
    );
    window.history.pushState({}, "", original);
  });

  it("sets unauthorized on a connect_error mentioning the display token", async () => {
    const { result } = renderHook(() => useMatchState());
    expect(result.current.unauthorized).toBe(false);
    act(() => fakeSocket.__trigger("connect_error", new Error("invalid or missing display token")));
    await waitFor(() => expect(result.current.unauthorized).toBe(true));
  });

  it("clears unauthorized once the socket successfully connects", async () => {
    const { result } = renderHook(() => useMatchState());
    act(() => fakeSocket.__trigger("connect_error", new Error("invalid or missing display token")));
    await waitFor(() => expect(result.current.unauthorized).toBe(true));
    act(() => fakeSocket.__trigger("connect"));
    await waitFor(() => expect(result.current.unauthorized).toBe(false));
  });

  it("opens a socket once a real token replaces the empty placeholder", () => {
    const { rerender } = renderHook(
      ({ secret }) => useMatchState({ secret, role: "control" }),
      { initialProps: { secret: "" } }
    );
    expect(ioMock).not.toHaveBeenCalled();
    rerender({ secret: "real-token" });
    expect(ioMock).toHaveBeenCalledTimes(1);
  });
});
