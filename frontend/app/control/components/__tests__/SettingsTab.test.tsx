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

  it("renders team colour, sport, and template sections", () => {
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(screen.getByText("Home — Team Colour")).toBeInTheDocument();
    expect(screen.getByText("Visitor — Team Colour")).toBeInTheDocument();
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

  it("applies template defaults when the button is clicked", () => {
    const push = vi.fn();
    render(<SettingsTab state={makeState()} push={push} />, { wrapper: swrWrapper });
    fireEvent.click(screen.getByText("Apply Template Defaults"));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ sport: "netball", period: "1", isRunning: false }));
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

  it("does not render the webhook/bridge admin cards for an OPERATOR role", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "OPERATOR", activeOrgId: "org1" } } });
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(screen.queryByText("Stream Deck / Webhooks")).not.toBeInTheDocument();
    expect(screen.queryByText("Bridge Devices")).not.toBeInTheDocument();
  });

  it("renders the webhook/bridge admin cards for a MANAGER role with an org", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "MANAGER", activeOrgId: "org1" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tokens: [], addOns: ["data-feed"] }) }));
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(screen.getByText("Stream Deck / Webhooks")).toBeInTheDocument();
    expect(await screen.findByText("Bridge Devices")).toBeInTheDocument();
    expect(await screen.findByPlaceholderText("Label (e.g. Venue laptop 1)")).toBeInTheDocument();
  });

  it("shows an upgrade prompt instead of the Bridge Devices form when the org lacks the Data Feed add-on (SA-114)", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "MANAGER", activeOrgId: "org1" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tokens: [], addOns: [] }) }));
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(await screen.findByText(/physical Saturn\/Vega scoreboard console/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Label (e.g. Venue laptop 1)")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mac" })).not.toBeInTheDocument();
  });

  it("shows an upgrade prompt for the Data Feed card when the org lacks the add-on", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "MANAGER", activeOrgId: "org1" } } });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/billing/status")) return Promise.resolve({ ok: true, json: async () => ({ addOns: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ tokens: [] }) });
    }));
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(await screen.findByText("Data Feed")).toBeInTheDocument();
    expect(await screen.findByText(/third-party graphics engine/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Label (e.g. Singular.live)")).not.toBeInTheDocument();
  });

  it("renders the Data Feed token form and generates a token when the org has the add-on", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "MANAGER", activeOrgId: "org1" } } });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/billing/status")) return Promise.resolve({ ok: true, json: async () => ({ addOns: ["data-feed"] }) });
      if (url === "/api/orgs/org1/tokens" && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ token: "the-plaintext-token" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ tokens: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });

    expect(await screen.findByText("No data feed tokens yet.")).toBeInTheDocument();
    const card = within(screen.getByText("Data Feed").closest("div")!);
    fireEvent.change(card.getByPlaceholderText("Label (e.g. Singular.live)"), { target: { value: "Singular.live" } });
    fireEvent.click(card.getByText("Generate Token"));

    expect(await screen.findByText("the-plaintext-token")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orgs/org1/tokens",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ label: "Singular.live", type: "DATA_FEED" }),
      })
    );
  });

  it("links the Bridge Devices card's download buttons to downloads.scorehub.co.nz", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeRole: "MANAGER", activeOrgId: "org1" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tokens: [], addOns: ["data-feed"] }) }));
    render(<SettingsTab state={makeState()} push={vi.fn()} />, { wrapper: swrWrapper });
    expect(await screen.findByRole("link", { name: "Mac" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mac" })).toHaveAttribute("href", "https://downloads.scorehub.co.nz/mac");
    expect(screen.getByRole("link", { name: "Windows" })).toHaveAttribute("href", "https://downloads.scorehub.co.nz/windows");
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
