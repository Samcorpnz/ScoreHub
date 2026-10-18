import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import { SettingsTab } from "../SettingsTab";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState } from "@scorehub/types";

// Several cards share an orgId across tests, so without a fresh SWR cache per
// render, a later test would see an earlier test's cached response instead
// of hitting its own fetch mock.
function swrWrapper({ children }: { readonly children: React.ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>;
}

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
}));

function makeState(): MatchState {
  return { ...DEFAULT_MATCH_STATE } as MatchState;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SettingsTab", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "OPERATOR", activeOrgId: undefined } } });
  });

  it("renders team, match name, sport, and template sections", () => {
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(screen.getByText("Home Team")).toBeInTheDocument();
    expect(screen.getByText("Visitor Team")).toBeInTheDocument();
    expect(screen.getByText("Match Name")).toBeInTheDocument();
    expect(screen.getByText("Sport")).toBeInTheDocument();
    expect(screen.getByText("Template Defaults — Netball")).toBeInTheDocument();
  });

  it("pushes an updated home color when a swatch is clicked", () => {
    const push = vi.fn();
    render(<SettingsTab state={makeState()} push={push} />, { wrapper: swrWrapper });
    fireEvent.click(screen.getByText("Netball").closest("button")!);
    expect(push).toHaveBeenCalledWith({ sport: "netball" });
  });

  it("pushes the selected sport when a sport tile is clicked", () => {
    const push = vi.fn();
    render(<SettingsTab state={makeState()} push={push} />, { wrapper: swrWrapper });
    fireEvent.click(screen.getByText("Basketball").closest("button")!);
    expect(push).toHaveBeenCalledWith({ sport: "basketball" });
  });

  it("shows each team's current name and renames it on Set or Enter", () => {
    const push = vi.fn();
    const state = { ...makeState(), home: { ...makeState().home, name: "Sharks" }, visitor: { ...makeState().visitor, name: "Magic" } } as MatchState;
    render(<SettingsTab state={state} push={push} />, { wrapper: swrWrapper });

    const home = screen.getByTestId("settings-home-name");
    expect(home).toHaveValue("Sharks");
    fireEvent.change(home, { target: { value: "  Southern Steel " } });
    fireEvent.click(screen.getByTestId("settings-home-name-set"));
    expect(push).toHaveBeenCalledWith({ home: expect.objectContaining({ name: "Southern Steel" }) });

    const visitor = screen.getByTestId("settings-visitor-name");
    fireEvent.change(visitor, { target: { value: "Northern Mystics" } });
    fireEvent.keyDown(visitor, { key: "Enter" });
    expect(push).toHaveBeenCalledWith({ visitor: expect.objectContaining({ name: "Northern Mystics" }) });
  });

  it("ignores a blank or unchanged name instead of wiping it", () => {
    const push = vi.fn();
    const state = { ...makeState(), home: { ...makeState().home, name: "Sharks" } } as MatchState;
    render(<SettingsTab state={state} push={push} />, { wrapper: swrWrapper });
    const home = screen.getByTestId("settings-home-name");

    fireEvent.change(home, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("settings-home-name-set"));
    expect(home).toHaveValue("Sharks");

    fireEvent.click(screen.getByTestId("settings-home-name-set"));
    expect(push).not.toHaveBeenCalled();
  });

  it("follows a rename made elsewhere until the operator starts typing", () => {
    const state = { ...makeState(), home: { ...makeState().home, name: "Sharks" } } as MatchState;
    const { rerender } = render(<SettingsTab state={state} push={vi.fn()} />, { wrapper: swrWrapper });
    rerender(<SettingsTab state={{ ...state, home: { ...state.home, name: "Steel" } }} push={vi.fn()} />);
    expect(screen.getByTestId("settings-home-name")).toHaveValue("Steel");
  });

  it("sets the match name", () => {
    const push = vi.fn();
    render(<SettingsTab state={makeState()} push={push} />, { wrapper: swrWrapper });
    fireEvent.change(screen.getByTestId("settings-match-name"), { target: { value: "Final" } });
    fireEvent.click(screen.getByTestId("settings-match-name-set"));
    expect(push).toHaveBeenCalledWith({ matchName: "Final" });
  });

  it("applies template defaults when the button is clicked", () => {
    const push = vi.fn();
    render(<SettingsTab state={makeState()} push={push} />, { wrapper: swrWrapper });
    fireEvent.click(screen.getByText("Apply Template Defaults"));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ period: "1", isRunning: false }));
    expect(push.mock.calls[0][0]).not.toHaveProperty("sport");
  });

  it("shows a set-up match's sport read-only, with no way to switch it", () => {
    const push = vi.fn();
    render(<SettingsTab state={makeState()} push={push} matchId="match1" />, { wrapper: swrWrapper });
    expect(screen.getByTestId("settings-sport")).toHaveTextContent("Netball");
    expect(screen.queryByText("Basketball")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "set up a new match" })).toHaveAttribute("href", "/setup");
  });

  it("switches a netball match to Fast5, bringing an untouched clock along", () => {
    const push = vi.fn();
    const state = { ...makeState(), countDown: true, clockSeconds: 900, sportConfig: { extraTimeSeconds: 300 } } as MatchState;
    render(<SettingsTab state={state} push={push} />, { wrapper: swrWrapper });
    fireEvent.click(screen.getByTestId("settings-format-fast5"));
    expect(push).toHaveBeenCalledWith({ sportConfig: { extraTimeSeconds: 300, format: "fast5" }, clockSeconds: 360 });
  });

  it("leaves the clock alone when changing format mid-match", () => {
    const push = vi.fn();
    const state = { ...makeState(), countDown: true, clockSeconds: 512, period: "2" } as MatchState;
    render(<SettingsTab state={state} push={push} />, { wrapper: swrWrapper });
    fireEvent.click(screen.getByTestId("settings-format-fast5"));
    expect(push).toHaveBeenCalledWith({ sportConfig: { format: "fast5" } });
  });

  it("describes a Fast5 match's own template, and offers no format for sports without one", () => {
    const fast5 = { ...makeState(), sportConfig: { format: "fast5" } } as MatchState;
    const { unmount } = render(<SettingsTab state={fast5} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(screen.getByText("Template Defaults — Fast5 Netball")).toBeInTheDocument();
    expect(screen.getByText("Counts down from 6:00")).toBeInTheDocument();
    unmount();
    render(<SettingsTab state={{ ...makeState(), sport: "basketball" } as MatchState} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(screen.queryByTestId("settings-format-fast5")).not.toBeInTheDocument();
  });

  it("does not render the End Match card without a matchId", () => {
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(screen.queryByTestId("end-match")).not.toBeInTheDocument();
  });

  it("renders the End Match card when matchId is provided, and ends the match on confirm", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "ADMIN", activeOrgId: "org1" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const onEnded = vi.fn();
    render(<SettingsTab state={makeState()} push={vi.fn()} matchId="match1" onEnded={onEnded} />, { wrapper: swrWrapper });
    fireEvent.click(screen.getByTestId("end-match"));
    await waitFor(() => expect(onEnded).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith("/api/orgs/org1/matches/match1/end", { method: "POST" });
  });

  it("does not end the match if the confirm dialog is dismissed", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "ADMIN", activeOrgId: "org1" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tokens: [] }) }));
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    render(<SettingsTab state={makeState()} push={vi.fn()} matchId="match1" />, { wrapper: swrWrapper });
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByTestId("end-match"));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows an error message when ending the match fails", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "ADMIN", activeOrgId: "org1" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Cannot end" }) }));
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<SettingsTab state={makeState()} push={vi.fn()} matchId="match1" />, { wrapper: swrWrapper });
    fireEvent.click(screen.getByTestId("end-match"));
    expect(await screen.findByText("Cannot end")).toBeInTheDocument();
  });

  it("does not render the Control API card for an OPERATOR role", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "OPERATOR", activeOrgId: "org1" } } });
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(screen.queryByText("Control API")).not.toBeInTheDocument();
  });

  it("shows a MANAGER this match's Control API URLs, with tokens left to the Account page", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "MANAGER", activeOrgId: "org1" } } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsTab state={makeState()} push={vi.fn()} matchId="m1" />, { wrapper: swrWrapper });

    expect(screen.getByText("Control API")).toBeInTheDocument();
    expect(screen.getByTitle(/\/action\/start\?matchId=m1$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account → Stream Deck / Control API" })).toHaveAttribute("href", "/account");
    // Org-wide tokens of every kind live on the Account page, not here.
    for (const title of ["Bridge Devices", "Data Feed", "Stream Deck / Control API"]) {
      expect(screen.queryByText(title)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Generate Token" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the relay URL with a Copy button and no developer instructions (SA-116)", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    const card = screen.getByText("Connection").closest("div")!.parentElement!;
    const relayUrl = screen.getByTestId("relay-url").textContent!;
    expect(relayUrl).toMatch(/^https?:\/\//);
    fireEvent.click(within(card).getByText("Copy"));
    expect(writeText).toHaveBeenCalledWith(relayUrl);
    expect(screen.queryByText(/NEXT_PUBLIC_RELAY_URL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vercel/)).not.toBeInTheDocument();
  });
});
