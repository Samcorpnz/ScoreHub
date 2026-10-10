import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { OutputsTab } from "../OutputsTab";

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
    render(<OutputsTab matchId="match1" />);
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
    render(<OutputsTab />);
    fireEvent.click(screen.getAllByText("Copy URL")[0]);
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/display/fullscreen");
  });

  it("opens a pop-out window when Pop Out is clicked", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    const openMock = vi.fn();
    vi.stubGlobal("open", openMock);
    render(<OutputsTab matchId="match1" />);
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
    render(<OutputsTab matchId="match1" />);
    fireEvent.click(screen.getAllByText("Copy URL")[0]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/display/fullscreen?org=org1&matchId=match1"));
  });

  it("renders the Graphics Control and Player Roster links scoped to the matchId", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    render(<OutputsTab matchId="match1" />);
    expect(screen.getByText("Graphics Control").closest("a")).toHaveAttribute("href", "/control/graphics?matchId=match1");
    expect(screen.getByText("Player Roster").closest("a")).toHaveAttribute("href", "/control/roster?matchId=match1");
  });

  it("renders the Graphics links without matchId query when matchId is absent", () => {
    useSessionMock.mockReturnValue({ data: null });
    render(<OutputsTab />);
    expect(screen.getByText("Graphics Control").closest("a")).toHaveAttribute("href", "/control/graphics");
  });

  it("appends the fetched displayToken to display URLs once known", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ matches: [{ id: "match1", displayToken: "the-token" }] }) })
    ));
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OutputsTab matchId="match1" />);
    await waitFor(() => {
      fireEvent.click(screen.getAllByText("Copy URL")[0]);
      expect(writeText).toHaveBeenLastCalledWith("http://localhost:3000/display/fullscreen?org=org1&matchId=match1&token=the-token");
    });
  });

  it("doesn't print the display links on the page", async () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    render(<OutputsTab matchId="match1" />);
    expect(screen.queryByText(/\/display\/fullscreen\?/)).not.toBeInTheDocument();
  });

  it("points third-party graphics software at the Data Feed add-on rather than the display feed", () => {
    useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1" } } });
    render(<OutputsTab matchId="match1" />);
    expect(screen.getByText("Graphics Software — Data Feed Add-on")).toBeInTheDocument();
    expect(screen.queryByText("REST snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText("matchStateChange")).not.toBeInTheDocument();
  });

  describe("Regenerate display link (SA-117)", () => {
    it.each(["ADMIN", "MANAGER"])("is shown to %s", role => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: role } } });
      render(<OutputsTab matchId="match1" />);
      expect(screen.getByText("Regenerate display link")).toBeInTheDocument();
    });

    it("is hidden from Operators, who the API would reject", () => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: "OPERATOR" } } });
      render(<OutputsTab matchId="match1" />);
      expect(screen.queryByText("Regenerate display link")).not.toBeInTheDocument();
    });

    it("shows an error when the request fails instead of silently doing nothing", async () => {
      useSessionMock.mockReturnValue({ data: { user: { activeOrgId: "org1", activeRole: "ADMIN" } } });
      vi.stubGlobal("confirm", vi.fn(() => true));
      vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
        Promise.resolve(init?.method === "POST"
          ? { ok: false, status: 403, json: () => Promise.resolve({ error: "forbidden" }) }
          : { ok: true, json: () => Promise.resolve({ matches: [] }) })));
      render(<OutputsTab matchId="match1" />);
      fireEvent.click(screen.getByText("Regenerate display link"));
      expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't regenerate the display link/);
    });
  });
});
