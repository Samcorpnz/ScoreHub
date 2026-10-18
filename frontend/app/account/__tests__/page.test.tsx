import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import AccountPage from "../page";

// Every test in this file uses the same orgId, so without a fresh SWR cache
// per render, a later test would see an earlier test's cached response
// instead of hitting its own fetch mock.
function renderPage() {
  return render(<AccountPage />, {
    wrapper: ({ children }) => <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>,
  });
}

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
}));

// Stripe's embedded checkout is only mounted once a clientSecret exists; stub
// it out so the "Upgrade" flow doesn't need a real Stripe.js instance.
vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: ({ children }: { readonly children: React.ReactNode }) => (
    <div data-testid="embedded-checkout-provider">{children}</div>
  ),
  EmbeddedCheckout: () => <div data-testid="embedded-checkout" />,
}));
vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => Promise.resolve(null),
}));

const adminSession = {
  data: {
    user: {
      name: "Sam Kerins",
      email: "sam@example.com",
      activeRole: "ADMIN",
      activeOrgId: "org-1",
      id: "user-1",
    },
  },
};

const freePlanStatus = {
  plan: "free",
  billingInterval: null,
  hasStripeCustomer: false,
  subscription: null,
  addOns: [],
  graphicsSubscription: null,
  dataFeedSubscription: null,
};

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body });
}

// Routes the DisplayNameCard/TeamCard/EmailCard's incidental fetches to
// harmless defaults so tests can focus on the billing flow, and lets each
// test override /api/billing/status specifically.
function mockFetchRouter(overrides: Record<string, () => Promise<unknown>> = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    for (const [key, handler] of Object.entries(overrides)) {
      if (url.includes(key) && (!init || true)) return handler();
    }
    if (url.includes("/api/billing/status")) return jsonResponse(freePlanStatus);
    if (url.includes("/api/account/email")) return jsonResponse({ pending: null });
    if (url.includes("/members")) return jsonResponse({ members: [] });
    if (url.includes("/invitations")) return jsonResponse({ invitations: [] });
    return jsonResponse({});
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AccountPage", () => {
  it("renders the organization card with the session's name and role", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal("fetch", mockFetchRouter());
    renderPage();
    expect(screen.getByText("Sam Kerins")).toBeInTheDocument();
    expect(screen.getByText("Role: ADMIN")).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/billing/status"));
  });

  it("shows the three plan tiers on the Free plan, with Free marked current", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal("fetch", mockFetchRouter());
    renderPage();

    await screen.findByText("Free");
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Venue")).toBeInTheDocument();
    expect(screen.getByText("Current plan")).toBeInTheDocument();
    expect(screen.getByText("Upgrade to Pro")).toBeInTheDocument();
  });

  it("hides upgrade buttons and shows a permissions note for a non-admin", async () => {
    useSessionMock.mockReturnValue({
      data: { user: { ...adminSession.data.user, activeRole: "OPERATOR" } },
    });
    vi.stubGlobal("fetch", mockFetchRouter());
    renderPage();

    await screen.findByText("Only an account ADMIN can change billing.");
    expect(screen.queryByText("Upgrade to Pro")).not.toBeInTheDocument();
  });

  it("starts checkout and shows the embedded checkout panel when upgrading", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/billing/checkout": () => jsonResponse({ clientSecret: "cs_test_123" }),
      })
    );
    renderPage();

    fireEvent.click(await screen.findByText("Upgrade to Pro"));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/billing/checkout",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ plan: "pro", interval: "month" }),
        })
      )
    );
    expect(await screen.findByTestId("embedded-checkout-provider")).toBeInTheDocument();
    // Checkout takes the full page, so the account cards are hidden until Back.
    expect(screen.queryByText("Plan & Billing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("← Back"));
    expect(await screen.findByText("Plan & Billing")).toBeInTheDocument();
  });

  it("sends an existing subscriber to Stripe's confirm page for a plan change", async () => {
    useSessionMock.mockReturnValue(adminSession);
    const assign = vi.fn();
    vi.stubGlobal("location", { search: "", assign });
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/billing/checkout": () => jsonResponse({ confirmUrl: "https://billing.stripe.com/p/session/test_1" }),
      })
    );
    renderPage();

    fireEvent.click(await screen.findByText("Upgrade to Pro"));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://billing.stripe.com/p/session/test_1"));
  });

  it("confirms the change after Stripe sends the customer back", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal("location", { search: "?billing=updated", assign: vi.fn() });
    const replaceState = vi.spyOn(globalThis.history, "replaceState").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockFetchRouter());
    renderPage();

    expect(await screen.findByText(/Your plan change is confirmed/)).toBeInTheDocument();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/account");
    replaceState.mockRestore();
  });

  it("shows the checkout error message when checkout fails to start", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/billing/checkout": () => jsonResponse({ error: "card declined" }),
      })
    );
    renderPage();

    fireEvent.click(await screen.findByText("Upgrade to Pro"));

    expect(await screen.findByText("card declined")).toBeInTheDocument();
  });

  it("shows the active subscription panel with a downgrade option once on a paid plan", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/billing/status": () =>
          jsonResponse({
            ...freePlanStatus,
            plan: "pro",
            billingInterval: "month",
            hasStripeCustomer: true,
            subscription: {
              status: "active",
              cancelAtPeriodEnd: false,
              currentPeriodEnd: 1893456000,
              amount: 8900,
              currency: "nzd",
            },
          }),
      })
    );
    renderPage();

    expect(await screen.findByText("Pro plan")).toBeInTheDocument();
    expect(screen.getByText("Downgrade to Free")).toBeInTheDocument();
    expect(screen.getByText("Need more capacity? Upgrade to Venue")).toBeInTheDocument();
    expect(screen.getByText("Manage billing")).toBeInTheDocument();
  });

  it("cancels the subscription via /api/billing/cancel and refreshes status", async () => {
    useSessionMock.mockReturnValue(adminSession);
    const fetchMock = mockFetchRouter({
      "/api/billing/status": () =>
        jsonResponse({
          ...freePlanStatus,
          plan: "pro",
          billingInterval: "month",
          subscription: { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: 1893456000, amount: 8900, currency: "nzd" },
        }),
      "/api/billing/cancel": () => jsonResponse({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    fireEvent.click(await screen.findByText("Downgrade to Free"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/billing/cancel",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ resume: false }) })
      )
    );
  });

  it("purchases the Graphics add-on and shows it as active with an amount", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/billing/status": () =>
          jsonResponse({
            ...freePlanStatus,
            plan: "pro",
          }),
      })
    );
    renderPage();

    expect(await screen.findByText("Graphics Operator")).toBeInTheDocument();
    expect(screen.getByText("Add Graphics Operator")).toBeInTheDocument();
    expect(screen.getByText("Data Feed")).toBeInTheDocument();
    expect(screen.getByText("Add Data Feed")).toBeInTheDocument();
  });

  it("shows a failed add-on checkout under that add-on, not up by the plans", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/billing/status": () => jsonResponse({ ...freePlanStatus, plan: "pro" }),
        "/api/billing/checkout": () => jsonResponse({ error: "Couldn't start checkout — please try again." }, false),
      })
    );
    renderPage();

    fireEvent.click(await screen.findByText("Add Data Feed"));
    expect(await screen.findByTestId("addon-notice-data-feed")).toHaveTextContent("Couldn't start checkout");
    expect(screen.queryByTestId("addon-notice-graphics-operator")).not.toBeInTheDocument();
  });

  it("shows an error under the add-on when the checkout response isn't JSON", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/billing/status": () => jsonResponse({ ...freePlanStatus, plan: "pro" }),
        "/api/billing/checkout": () => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new SyntaxError("no body")) }),
      })
    );
    renderPage();

    fireEvent.click(await screen.findByText("Add Graphics Operator"));
    expect(await screen.findByTestId("addon-notice-graphics-operator")).toHaveTextContent("Couldn't start checkout");
  });

  it("warns when some billing details couldn't be loaded from Stripe", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal("fetch", mockFetchRouter({
      "/api/billing/status": () => jsonResponse({ ...freePlanStatus, plan: "pro", stripeUnavailable: true }),
    }));
    renderPage();
    expect(await screen.findByTestId("billing-stripe-unavailable")).toHaveTextContent("couldn't be loaded");
  });

  it("shows both add-ons requiring a base plan note when on Free", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal("fetch", mockFetchRouter());
    renderPage();

    expect(await screen.findAllByText("Requires a Pro or Venue plan.")).toHaveLength(2);
  });

  it("saves a new display name via DisplayNameCard", async () => {
    useSessionMock.mockReturnValue(adminSession);
    const fetchMock = mockFetchRouter({
      "/api/account/name": () => jsonResponse({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    const nameInput = screen.getByDisplayValue("Sam Kerins");
    fireEvent.change(nameInput, { target: { value: "Samuel Kerins" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/name",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Samuel Kerins" }) })
      )
    );
    expect(await screen.findByText("Name updated.")).toBeInTheDocument();
  });

  it("shows an error when saving the display name fails", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/account/name": () => jsonResponse({ error: "name too long" }, false),
      })
    );
    renderPage();

    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("name too long")).toBeInTheDocument();
  });

  it("updates the password via PasswordCard and clears the fields on success", async () => {
    useSessionMock.mockReturnValue(adminSession);
    const fetchMock = mockFetchRouter({
      "/api/account/password": () => jsonResponse({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    const [currentPw, newPw] = screen.getAllByPlaceholderText(/password/i).filter(
      el => el.getAttribute("placeholder") === "Current password" || el.getAttribute("placeholder")?.startsWith("New password")
    );
    fireEvent.change(currentPw, { target: { value: "old-pass" } });
    fireEvent.change(newPw, { target: { value: "new-password-123" } });
    fireEvent.click(screen.getByText("Update Password"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/password",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ currentPassword: "old-pass", newPassword: "new-password-123" }),
        })
      )
    );
    expect(await screen.findByText("Password updated.")).toBeInTheDocument();
    expect((currentPw as HTMLInputElement).value).toBe("");
  });

  it("shows a pending-verification notice for the EmailCard when one already exists", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal(
      "fetch",
      mockFetchRouter({
        "/api/account/email": () => jsonResponse({ pending: "new@example.com" }),
      })
    );
    renderPage();

    expect(
      await screen.findByText("A verification link was sent to new@example.com — click it to confirm the change.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Change email")).not.toBeInTheDocument();
  });

  it("requests an email change via EmailCard's form", async () => {
    useSessionMock.mockReturnValue(adminSession);
    const fetchMock = mockFetchRouter({
      "/api/account/email": (() => {
        let called = false;
        return () => {
          if (!called) {
            called = true;
            return jsonResponse({ pending: null });
          }
          return jsonResponse({ newEmail: "changed@example.com" });
        };
      })(),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    fireEvent.click(await screen.findByText("Change email"));
    fireEvent.change(screen.getByPlaceholderText("New email address"), { target: { value: "changed@example.com" } });
    // PasswordCard also has a "Current password" field — EmailCard's is the
    // second one rendered on the page.
    const currentPasswordFields = screen.getAllByPlaceholderText("Current password");
    fireEvent.change(currentPasswordFields[currentPasswordFields.length - 1], { target: { value: "current-pw" } });
    fireEvent.click(screen.getByText("Send verification link"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/email",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ newEmail: "changed@example.com", currentPassword: "current-pw" }),
        })
      )
    );
  });

  it("invites a team member via the Team card", async () => {
    useSessionMock.mockReturnValue(adminSession);
    const fetchMock = mockFetchRouter({
      "/api/orgs/org-1/invitations": () => jsonResponse({ invitations: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await screen.findByText("Team");
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "newperson@example.com" } });
    fireEvent.click(screen.getByText("Invite"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/orgs/org-1/invitations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "newperson@example.com", role: "VIEWER" }),
        })
      )
    );
    expect(await screen.findByText("Invitation sent to newperson@example.com.")).toBeInTheDocument();
  });

  it("does not render the Team card for a VIEWER-role user", async () => {
    useSessionMock.mockReturnValue({
      data: { user: { ...adminSession.data.user, activeRole: "VIEWER" } },
    });
    vi.stubGlobal("fetch", mockFetchRouter());
    renderPage();

    await screen.findByText("Display Name");
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
    expect(screen.queryByText("Bridge Devices")).not.toBeInTheDocument();
    expect(screen.queryByText("Stream Deck / Control API")).not.toBeInTheDocument();
  });

  it("shows the Bridge Devices form and download links when the org has the Data Feed add-on", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal("fetch", mockFetchRouter({
      "/api/billing/status": () => jsonResponse({ ...freePlanStatus, plan: "pro", addOns: ["data-feed"] }),
      "/tokens": () => jsonResponse({ tokens: [] }),
      "/matches": () => jsonResponse({ matches: [] }),
    }));
    renderPage();

    expect(await screen.findByText("Bridge Devices")).toBeInTheDocument();
    expect(await screen.findByPlaceholderText("Label (e.g. Venue laptop 1)")).toBeInTheDocument();
    expect(await screen.findByText("No bridge tokens yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mac" })).toHaveAttribute("href", "https://downloads.scorehub.co.nz/mac");
    expect(screen.getByRole("link", { name: "Windows" })).toHaveAttribute("href", "https://downloads.scorehub.co.nz/windows");
  });

  it("generates a bridge token pinned to a match", async () => {
    useSessionMock.mockReturnValue(adminSession);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/billing/status")) return jsonResponse({ ...freePlanStatus, plan: "pro", addOns: ["data-feed"] });
      if (url === "/api/orgs/org-1/tokens" && init?.method === "POST") return jsonResponse({ token: "bridge-plaintext" });
      if (url.includes("/tokens")) return jsonResponse({ tokens: [] });
      if (url.includes("/matches")) {
        return jsonResponse({ matches: [{ id: "m1", homeName: "Pulse", visitorName: "Magic", status: "LIVE" }] });
      }
      return mockFetchRouter()(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    fireEvent.change(await screen.findByPlaceholderText("Label (e.g. Venue laptop 1)"), { target: { value: "Court 1" } });
    const bridge = within(screen.getByText("Bridge Devices").parentElement!);
    await bridge.findByRole("option", { name: "Pulse v Magic (live)" });
    fireEvent.change(bridge.getByLabelText("Pin to match"), { target: { value: "m1" } });
    fireEvent.click(bridge.getByRole("button", { name: "Generate Token" }));

    expect(await screen.findByText("bridge-plaintext")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orgs/org-1/tokens",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ label: "Court 1", type: "BRIDGE", matchId: "m1" }) }),
    );
  });

  it("lists each token with the match it's pinned to, or All matches", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal("fetch", mockFetchRouter({
      "/api/billing/status": () => jsonResponse({ ...freePlanStatus, plan: "pro", addOns: ["data-feed"] }),
      "/tokens": () => jsonResponse({ tokens: [
        { id: "t1", label: "Laptop A", type: "BRIDGE", matchId: null, createdAt: "2026-10-01T00:00:00Z", revokedAt: null },
        { id: "t2", label: "Laptop B", type: "BRIDGE", matchId: "m1", createdAt: "2026-10-01T00:00:00Z", revokedAt: null },
      ] }),
      "/matches": () => jsonResponse({ matches: [{ id: "m1", homeName: "Pulse", visitorName: "Magic", status: "LIVE" }] }),
    }));
    renderPage();

    expect(await screen.findByText("Laptop A")).toBeInTheDocument();
    expect(screen.getByText(/^All matches ·/)).toBeInTheDocument();
    expect(await screen.findByText(/^Pinned to Pulse v Magic ·/)).toBeInTheDocument();
  });

  it("generates Stream Deck tokens on every plan, with no add-on needed", async () => {
    useSessionMock.mockReturnValue(adminSession);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/orgs/org-1/tokens" && init?.method === "POST") return jsonResponse({ token: "deck-plaintext" });
      if (url.includes("/tokens")) return jsonResponse({ tokens: [] });
      if (url.includes("/matches")) return jsonResponse({ matches: [] });
      return mockFetchRouter()(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    const placeholder = await screen.findByPlaceholderText("Label (e.g. Court 1 Stream Deck)");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/scorehub.streamDeckPlugin");
    fireEvent.change(placeholder, { target: { value: "Court 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Token" }));

    expect(await screen.findByText("deck-plaintext")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orgs/org-1/tokens",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ label: "Court 1", type: "CONTROL" }) }),
    );
  });

  it("generates a data feed token when the org has the add-on, and explains how to pick a match", async () => {
    useSessionMock.mockReturnValue(adminSession);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/billing/status")) return jsonResponse({ ...freePlanStatus, plan: "pro", addOns: ["data-feed"] });
      if (url === "/api/orgs/org-1/tokens" && init?.method === "POST") return jsonResponse({ token: "feed-plaintext" });
      if (url.includes("/tokens")) return jsonResponse({ tokens: [] });
      if (url.includes("/matches")) return jsonResponse({ matches: [] });
      return mockFetchRouter()(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    const placeholder = await screen.findByPlaceholderText("Label (e.g. Singular.live)");
    expect(screen.getByText(/\/api\/matches$/)).toBeInTheDocument();
    fireEvent.change(placeholder, { target: { value: "Singular.live" } });
    const card = placeholder.closest("div")!.parentElement!;
    fireEvent.click(within(card).getByRole("button", { name: "Generate Token" }));

    expect(await screen.findByText("feed-plaintext")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orgs/org-1/tokens",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ label: "Singular.live", type: "DATA_FEED" }) }),
    );
  });

  it("shows an upgrade prompt instead of the Bridge Devices form without the Data Feed add-on (SA-114)", async () => {
    useSessionMock.mockReturnValue(adminSession);
    vi.stubGlobal("fetch", mockFetchRouter());
    renderPage();

    expect(await screen.findByText(/physical Saturn\/Vega scoreboard console/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Label (e.g. Venue laptop 1)")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mac" })).not.toBeInTheDocument();
    expect(screen.getByText(/^Pipe live match state into a third-party graphics engine/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Label (e.g. Singular.live)")).not.toBeInTheDocument();
    // Stream Deck needs no add-on, so its form is still there.
    expect(screen.getByPlaceholderText("Label (e.g. Court 1 Stream Deck)")).toBeInTheDocument();
  });
});
