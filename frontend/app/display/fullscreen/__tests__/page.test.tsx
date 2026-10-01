import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import FullscreenDisplay from "../page";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState } from "@scorehub/types";

const { useMatchStateMock } = vi.hoisted(() => ({ useMatchStateMock: vi.fn() }));

vi.mock("../../../hooks/useMatchState", () => ({
  useMatchState: useMatchStateMock,
}));

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return { ...DEFAULT_MATCH_STATE, ...overrides } as MatchState;
}

beforeEach(() => {
  useMatchStateMock.mockReturnValue({ state: makeState(), status: "connected", relayUnreachable: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FullscreenDisplay", () => {
  it("defaults to the wide layout, showing both team sides", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, name: "Sharks" }, visitor: { ...DEFAULT_MATCH_STATE.visitor, name: "Eagles" } }),
      status: "connected",
      relayUnreachable: false,
    });
    render(<FullscreenDisplay />);
    expect(screen.getByText("Sharks")).toBeInTheDocument();
    expect(screen.getByText("Eagles")).toBeInTheDocument();
  });

  it.each([["wide", null], ["stacked", "2"], ["minimal", "3"]])("exposes the live scores via display-score-* test IDs in the %s layout", (_name, key) => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ home: { ...DEFAULT_MATCH_STATE.home, score: 8 }, visitor: { ...DEFAULT_MATCH_STATE.visitor, score: 6 } }),
      status: "connected",
      relayUnreachable: false,
    });
    render(<FullscreenDisplay />);
    if (key) fireEvent.keyDown(window, { key });
    // e2e/smoke specs read the score through these hooks — keep them stable.
    expect(screen.getByTestId("display-score-home")).toHaveTextContent("8");
    expect(screen.getByTestId("display-score-visitor")).toHaveTextContent("6");
  });

  it("switches to the stacked layout on pressing '2'", () => {
    render(<FullscreenDisplay />);
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByText("Stack [2]")).toBeInTheDocument();
  });

  it("switches to the minimal layout on pressing '3', rendering the clock digit", () => {
    useMatchStateMock.mockReturnValue({
      state: makeState({ clockSeconds: 90, isRunning: false }),
      status: "connected",
      relayUnreachable: false,
    });
    render(<FullscreenDisplay />);
    fireEvent.keyDown(window, { key: "3" });
    expect(document.querySelector(".clock-digit")).toBeInTheDocument();
  });

  it("returns to the wide layout on pressing '1'", () => {
    render(<FullscreenDisplay />);
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByText(DEFAULT_MATCH_STATE.home.name)).toBeInTheDocument();
  });

  it("toggles the HUD visibility on pressing 'h'", () => {
    const { container } = render(<FullscreenDisplay />);
    const hud = container.querySelector(".absolute.top-4.right-4")!.parentElement as HTMLElement;
    expect(hud.style.opacity).toBe("1");
    fireEvent.keyDown(window, { key: "h" });
    expect(hud.style.opacity).toBe("0");
    fireEvent.keyDown(window, { key: "h" });
    expect(hud.style.opacity).toBe("1");
  });

  it("toggles fullscreen state via the Fullscreen button", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", { value: requestFullscreen, configurable: true });
    render(<FullscreenDisplay />);
    fireEvent.click(screen.getByText(/Fullscreen \[F\]/));
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it("shows the CONNECTING badge in the HUD before matchStateChange arrives", () => {
    useMatchStateMock.mockReturnValue({ state: makeState(), status: "connecting", relayUnreachable: false });
    render(<FullscreenDisplay />);
    expect(screen.getByTestId("connection-status")).toHaveTextContent("CONNECTING");
  });
});
