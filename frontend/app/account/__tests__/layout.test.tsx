import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AccountLayout from "../layout";

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

vi.mock("../../components/OrgSwitcher", () => ({
  OrgSwitcher: () => <div data-testid="org-switcher" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AccountLayout", () => {
  it("shows a loading state while the session is resolving", () => {
    useSessionMock.mockReturnValue({ data: null, status: "loading" });
    render(
      <AccountLayout>
        <div>child</div>
      </AccountLayout>
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("child")).not.toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", () => {
    useSessionMock.mockImplementation((opts?: { onUnauthenticated?: () => void }) => {
      opts?.onUnauthenticated?.();
      return { data: null, status: "unauthenticated" };
    });
    render(
      <AccountLayout>
        <div>child</div>
      </AccountLayout>
    );
    expect(pushMock).toHaveBeenCalledWith("/login?callbackUrl=/account");
  });

  it("renders the header, user's name, and children once authenticated", () => {
    useSessionMock.mockReturnValue({
      data: { user: { name: "Sam Kerins" } },
      status: "authenticated",
    });
    render(
      <AccountLayout>
        <div>account content</div>
      </AccountLayout>
    );
    expect(screen.getByText("Sam Kerins")).toBeInTheDocument();
    expect(screen.getByText("account content")).toBeInTheDocument();
    expect(screen.getByTestId("org-switcher")).toBeInTheDocument();
    expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/dashboard");
  });

  it("signs out and redirects to /login when 'Sign out' is clicked", () => {
    useSessionMock.mockReturnValue({
      data: { user: { name: "Sam Kerins" } },
      status: "authenticated",
    });
    render(
      <AccountLayout>
        <div>account content</div>
      </AccountLayout>
    );
    fireEvent.click(screen.getByText("Sign out"));
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });
});
