import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { OutputsTab } from "../OutputsTab";
import { DEFAULT_MATCH_STATE, MatchState } from "../../../types";

const baseProps = { state: DEFAULT_MATCH_STATE as MatchState, push: vi.fn(), controlToken: "ctl" };

// Billing status (add-ons) and the display-token lookup share one fetch stub
function stubFetch(addOns: string[]) {
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url === "/api/billing/status"
    ? { ok: true, json: () => Promise.resolve({ plan: "pro", addOns }) }
    : { ok: true, json: () => Promise.resolve({ matches: [], tokens: [] }) })));
}

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
}));

// OutputsTab fetches the match's displayToken to append to display URLs —
// stub it to "no token yet" by default so existing assertions (which predate
// the token param) keep matching; a couple of tests below override this to
// assert the token actually gets appended once known.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ matches: [] }) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("OutputsTab", () => {
  it("renders a card for each display output with the matchId/org query params applied", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    render(<OutputsTab {...baseProps} matchId="match1" />);
    expect(screen.getByText("Fullscreen")).toBeInTheDocument();
    expect(screen.getByText("Basic")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText("Lower-Third Overlay")).toBeInTheDocument();
    expect(screen.getByText("Scorebug")).toBeInTheDocument();
    expect(screen.getAllByText("Copy URL")).toHaveLength(5);
  });

  it("copies URLs without query params when there is no org or match", () => {
    useSessionMock.mockReturnValue({ data: null });
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OutputsTab {...baseProps} />);
    fireEvent.click(screen.getAllByText("Copy URL")[0]);
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/display/fullscreen");
  });

  it("opens a pop-out window when Pop Out is clicked", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    const openMock = vi.fn();
    vi.stubGlobal("open", openMock);
    render(<OutputsTab {...baseProps} matchId="match1" />);
    fireEvent.click(screen.getAllByText("↗ Pop Out")[0]);
    expect(openMock).toHaveBeenCalledWith(
      expect.stringContaining("/display/fullscreen?org=org1&matchId=match1"),
      "scoreboard-Fullscreen",
      expect.stringContaining("width=1920,height=1080")
    );
  });

  it("copies the URL to the clipboard when Copy URL is clicked", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OutputsTab {...baseProps} matchId="match1" />);
    fireEvent.click(screen.getAllByText("Copy URL")[0]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/display/fullscreen?org=org1&matchId=match1"));
  });

  it("renders the Graphics Control and Player Roster links scoped to the matchId", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    render(<OutputsTab {...baseProps} matchId="match1" />);
    expect(screen.getByText("Graphics Control").closest("a")).toHaveAttribute("href", "/control/graphics?matchId=match1");
    expect(screen.getByText("Player Roster").closest("a")).toHaveAttribute("href", "/control/roster?matchId=match1");
  });

  it("renders the Graphics links without matchId query when matchId is absent", () => {
    useSessionMock.mockReturnValue({ data: null });
    render(<OutputsTab {...baseProps} />);
    expect(screen.getByText("Graphics Control").closest("a")).toHaveAttribute("href", "/control/graphics");
  });

  it("appends the fetched displayToken to display URLs once known", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ matches: [{ id: "match1", displayToken: "the-token" }] }) })
    ));
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OutputsTab {...baseProps} matchId="match1" />);
    await waitFor(() => {
      fireEvent.click(screen.getAllByText("Copy URL")[0]);
      expect(writeText).toHaveBeenLastCalledWith("http://localhost:3000/display/fullscreen?org=org1&matchId=match1&token=the-token");
    });
  });

  it("doesn't print the display links on the page", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    render(<OutputsTab {...baseProps} matchId="match1" />);
    expect(screen.queryByText(/\/display\/fullscreen\?/)).not.toBeInTheDocument();
  });

  it("points third-party graphics software at the Data Feed add-on rather than the display feed", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    render(<OutputsTab {...baseProps} matchId="match1" />);
    expect(screen.getByText("Graphics Software — Data Feed Add-on")).toBeInTheDocument();
    expect(screen.queryByText("REST snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText("matchStateChange")).not.toBeInTheDocument();
  });

  describe("Regenerate display link (SA-117)", () => {
    it.each(["ADMIN", "MANAGER"])("is shown to %s", role => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: role } } });
      render(<OutputsTab {...baseProps} matchId="match1" />);
      expect(screen.getByText("Regenerate display link")).toBeInTheDocument();
    });

    it("is hidden from Operators, who the API would reject", () => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: "OPERATOR" } } });
      render(<OutputsTab {...baseProps} matchId="match1" />);
      expect(screen.queryByText("Regenerate display link")).not.toBeInTheDocument();
    });

    it("shows an error when the request fails instead of silently doing nothing", async () => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: "ADMIN" } } });
      vi.stubGlobal("confirm", vi.fn(() => true));
      vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
        Promise.resolve(init?.method === "POST"
          ? { ok: false, status: 403, json: () => Promise.resolve({ error: "forbidden" }) }
          : { ok: true, json: () => Promise.resolve({ matches: [] }) })));
      render(<OutputsTab {...baseProps} matchId="match1" />);
      fireEvent.click(screen.getByText("Regenerate display link"));
      expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't regenerate the display link/);
    });
  });

  describe("Graphics add-on output options", () => {
    it("hides key links and per-output styling without the add-on", async () => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: "ADMIN" } } });
      stubFetch(["data-feed"]);
      render(<OutputsTab {...baseProps} matchId="match1" />);
      expect(await screen.findByText(/also unlocks per-output fonts/)).toBeInTheDocument();
      expect(screen.queryByTestId("key-link-Scorebug-green")).not.toBeInTheDocument();
      expect(screen.queryByTestId("output-styles")).not.toBeInTheDocument();
      expect(screen.queryByTestId("graphics-data-card")).not.toBeInTheDocument();
    });

    it("copies a green key URL for the keyable outputs", async () => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: "ADMIN" } } });
      stubFetch(["graphics-operator"]);
      const writeText = vi.fn();
      Object.assign(navigator, { clipboard: { writeText } });
      render(<OutputsTab {...baseProps} matchId="match1" />);
      fireEvent.click(await screen.findByTestId("key-link-Scorebug-green"));
      expect(writeText).toHaveBeenCalledWith("http://localhost:3000/display/scorebug?org=org1&matchId=match1&key=green");
      // Fullscreen/basic/advanced already take a background, so no key link
      expect(screen.queryByTestId("key-link-Fullscreen-green")).not.toBeInTheDocument();
      expect(screen.getByTestId("key-link-Graphics-blue")).toBeInTheDocument();
    });

    it("pushes a per-output size change on top of the match theme", async () => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: "ADMIN" } } });
      stubFetch(["graphics-operator"]);
      const push = vi.fn();
      render(<OutputsTab {...baseProps} push={push} matchId="match1" />);
      fireEvent.click(await screen.findByTestId("output-style-tab-scorebug"));
      fireEvent.change(screen.getByTestId("output-style-scoreScale"), { target: { value: "1.5" } });
      expect(push).toHaveBeenLastCalledWith({
        displayTheme: expect.objectContaining({ outputs: { scorebug: { scoreScale: 1.5 } } }),
      });
    });

    it("leaves creating the data link to Admins and Managers", async () => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: "OPERATOR" } } });
      stubFetch(["graphics-operator"]);
      render(<OutputsTab {...baseProps} matchId="match1" />);
      expect(await screen.findByText("An Admin or Manager creates the data link here.")).toBeInTheDocument();
      expect(screen.queryByTestId("graphics-data-generate")).not.toBeInTheDocument();
    });
  });
});
