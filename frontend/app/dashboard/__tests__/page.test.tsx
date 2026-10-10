import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import DashboardPage from "../page";

// Every test in this file uses the same orgId, so without a fresh SWR cache
// per render, a later test would see an earlier test's cached response
// instead of hitting its own fetch mock.
function renderPage() {
  return render(<DashboardPage />, {
    wrapper: ({ children }) => <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>,
  });
}

const { pushMock, useSessionMock, signOutMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  useSessionMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
  signOut: signOutMock,
}));

vi.mock("../../components/PlanBadge", () => ({ PlanBadge: () => <div data-testid="plan-badge" /> }));
vi.mock("../../components/OrgSwitcher", () => ({ OrgSwitcher: () => <div data-testid="org-switcher" /> }));

const authedSession = {
  data: { user: { name: "Sam Kerins", activeOrgId: "org-1" } },
  status: "authenticated" as const,
};

function matchRow(overrides: Partial<{
  id: string; status: "SCHEDULED" | "LIVE" | "ENDED"; sport: string | null; competition: string | null;
  homeName: string | null; visitorName: string | null; scheduledAt: string | null; createdAt: string; endedAt: string | null;
}> = {}) {
  return {
    id: "match-1",
    status: "LIVE" as const,
    sport: "netball",
    competition: "Regional",
    homeName: "Sharks",
    visitorName: "Magic",
    scheduledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DashboardPage", () => {
  it("shows a loading state while the session is resolving", () => {
    useSessionMock.mockReturnValue({ data: null, status: "loading" });
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", () => {
    useSessionMock.mockImplementation((opts?: { onUnauthenticated?: () => void }) => {
      opts?.onUnauthenticated?.();
      return { data: null, status: "unauthenticated" };
    });
    renderPage();
    expect(pushMock).toHaveBeenCalledWith("/login?callbackUrl=/dashboard");
  });

  it("fetches live matches by default and renders them", async () => {
    useSessionMock.mockReturnValue(authedSession);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [matchRow()] }) });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/orgs/org-1/matches?status=LIVE"))
    );
    expect(await screen.findByText("Sharks v Magic")).toBeInTheDocument();
    expect(screen.getByText("Open Control →").closest("a")).toHaveAttribute("href", "/control?matchId=match-1");
  });

  it("shows 'No matches here yet.' when the list is empty", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) }));
    renderPage();
    await waitFor(() => expect(screen.getByText("No matches here yet.")).toBeInTheDocument());
  });

  it("re-fetches with the SCHEDULED status when switching to the Upcoming tab", async () => {
    useSessionMock.mockReturnValue(authedSession);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByText("upcoming"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("status=SCHEDULED"))
    );
    expect(screen.getByText("Upload Fixtures")).toBeInTheDocument();
  });

  it("includes the search query in the matches request", async () => {
    useSessionMock.mockReturnValue(authedSession);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText("Search team name…"), { target: { value: "Sharks" } });

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("q=Sharks")));
  });

  it("shows 'Ended' with no link for ended matches, and 'Start →' for scheduled matches", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ matches: [matchRow({ id: "ended-1", status: "ENDED" })] }),
      })
    );
    renderPage();
    expect(await screen.findByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText("Copy display link")).not.toBeInTheDocument();
  });

  it("copies the display link to the clipboard when 'Copy display link' is clicked", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [matchRow()] }) }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderPage();
    const copyButton = await screen.findByText("Copy display link");
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("uploads parsed CSV fixtures via the bulk endpoint and reloads on success", async () => {
    useSessionMock.mockReturnValue(authedSession);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByText("upcoming"));
    fireEvent.click(screen.getByText("Upload Fixtures"));

    const csv = "sport,competition,home,visitor,scheduledAt\nnetball,Regional,Sharks,Magic,2026-05-01T10:00:00.000Z";
    const file = new File([csv], "fixtures.csv", { type: "text/csv" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText("Upload 1 Fixtures")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    fireEvent.click(screen.getByText("Upload 1 Fixtures"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/orgs/org-1/matches/bulk",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            fixtures: [
              {
                sport: "netball",
                competition: "Regional",
                home: "Sharks",
                visitor: "Magic",
                scheduledAt: "2026-05-01T10:00:00.000Z",
                matchName: undefined,
              },
            ],
          }),
        })
      )
    );
    // The upload panel closes itself (onDone) after a successful upload.
    await waitFor(() => expect(screen.queryByText("Upload 1 Fixtures")).not.toBeInTheDocument());
  });

  it("shows parse errors for CSV rows missing required fields", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) }));
    renderPage();
    fireEvent.click(screen.getByText("upcoming"));
    fireEvent.click(screen.getByText("Upload Fixtures"));

    const csv = "sport,competition,home,visitor\n,Regional,Sharks,Magic";
    const file = new File([csv], "fixtures.csv", { type: "text/csv" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText("row 1: missing sport/home/visitor")).toBeInTheDocument();
  });

  it("reads a CSV time without an offset in the browser's timezone and sends it as UTC", async () => {
    useSessionMock.mockReturnValue(authedSession);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    fireEvent.click(screen.getByText("upcoming"));
    fireEvent.click(screen.getByText("Upload Fixtures"));
    expect(screen.getByTestId("fixture-timezone")).toHaveTextContent(Intl.DateTimeFormat().resolvedOptions().timeZone);

    const csv = "sport,home,visitor,scheduledAt\nnetball,Sharks,Magic,2026-10-17T18:30";
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([csv], "fixtures.csv", { type: "text/csv" })] } });
    fireEvent.click(await screen.findByText("Upload 1 Fixtures"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/orgs/org-1/matches/bulk",
      expect.objectContaining({
        body: expect.stringContaining(new Date(2026, 9, 17, 18, 30).toISOString()),
      }),
    ));
  });

  it("rejects a CSV row whose date can't be read", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) }));
    renderPage();
    fireEvent.click(screen.getByText("upcoming"));
    fireEvent.click(screen.getByText("Upload Fixtures"));

    const csv = "sport,home,visitor,scheduledAt\nnetball,Sharks,Magic,next Saturday";
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([csv], "fixtures.csv", { type: "text/csv" })] } });

    expect(await screen.findByText(/row 1: unreadable date "next Saturday"/)).toBeInTheDocument();
  });

  const operatorSession = {
    data: { user: { name: "Sam Kerins", activeOrgId: "org-1", activeRole: "OPERATOR" } },
    status: "authenticated" as const,
  };

  it("offers Reopen only to roles that can run matches", async () => {
    useSessionMock.mockReturnValue({ ...operatorSession, data: { user: { ...operatorSession.data.user, activeRole: "VIEWER" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [matchRow({ id: "ended-1", status: "ENDED" })] }) }));
    renderPage();
    expect(await screen.findByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText("Reopen")).not.toBeInTheDocument();
  });

  it("reopens an ended match and opens its control panel", async () => {
    useSessionMock.mockReturnValue(operatorSession);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(
      init?.method === "POST"
        ? { ok: true, json: async () => ({ ok: true }) }
        : { ok: true, json: async () => ({ matches: [matchRow({ id: "ended-1", status: "ENDED" })] }) },
    ));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderPage();
    fireEvent.click(await screen.findByText("Reopen"));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/control?matchId=ended-1"));
    expect(fetchMock).toHaveBeenCalledWith("/api/orgs/org-1/matches/ended-1/reopen", { method: "POST" });
  });

  it("shows why an ended match couldn't be reopened", async () => {
    useSessionMock.mockReturnValue(operatorSession);
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => Promise.resolve(
      init?.method === "POST"
        ? { ok: false, json: async () => ({ error: "Free plan allows one live match at a time" }) }
        : { ok: true, json: async () => ({ matches: [matchRow({ id: "ended-1", status: "ENDED" })] }) },
    )));
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderPage();
    fireEvent.click(await screen.findByText("Reopen"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Free plan allows one live match at a time");
  });

  it("signs out and redirects to /login", async () => {
    useSessionMock.mockReturnValue(authedSession);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) }));
    renderPage();
    fireEvent.click(screen.getByText("Sign out"));
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });
});
