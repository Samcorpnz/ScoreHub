import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { PoweredByWatermark } from "../PoweredByWatermark";

function stubEntitlement(...answers: boolean[]) {
  const fetchMock = vi.fn();
  for (const watermark of answers) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ watermark }) });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

describe("PoweredByWatermark", () => {
  it("renders for a Free-tier org, scoped by the display link's org and match", async () => {
    globalThis.history.replaceState(null, "", "/display/basic?org=org-1&matchId=m-1&token=t");
    const fetchMock = stubEntitlement(true);
    render(<PoweredByWatermark />);
    expect(await screen.findByTestId("powered-by-watermark")).toHaveTextContent("Powered by ScoreHub");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/display\/entitlement\?org=org-1&matchId=m-1$/);
  });

  it("renders nothing for a paid org", async () => {
    const fetchMock = stubEntitlement(false);
    render(<PoweredByWatermark />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("powered-by-watermark")).not.toBeInTheDocument();
  });

  it("disappears on the next re-check after an upgrade, without a reload", async () => {
    vi.useFakeTimers();
    stubEntitlement(true, false);
    render(<PoweredByWatermark />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("powered-by-watermark")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.queryByTestId("powered-by-watermark")).not.toBeInTheDocument();
  });

  it("keeps the last known answer when the relay can't be reached", async () => {
    vi.useFakeTimers();
    const fetchMock = stubEntitlement(true);
    fetchMock.mockRejectedValue(new Error("network"));
    render(<PoweredByWatermark />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByTestId("powered-by-watermark")).toBeInTheDocument();
  });
});
