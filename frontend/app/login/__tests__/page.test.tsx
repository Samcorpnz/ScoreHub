import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import LoginPage from "../page";

const { pushMock, searchParamsMock, signInMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParamsMock: vi.fn(),
  signInMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock(),
}));

vi.mock("next-auth/react", () => ({
  signIn: signInMock,
}));

function paramsWithCallback(callbackUrl: string | null) {
  return { get: (key: string) => (key === "callbackUrl" ? callbackUrl : null) };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginPage", () => {
  it("shows validation errors after blurring empty fields, and keeps submit disabled", () => {
    searchParamsMock.mockReturnValue(paramsWithCallback(null));
    const { container } = render(<LoginPage />);

    fireEvent.blur(container.querySelector('input[type="email"]')!);
    fireEvent.blur(container.querySelector('input[type="password"]')!);

    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeDisabled();
  });

  it("shows an invalid-email message for a malformed address", () => {
    searchParamsMock.mockReturnValue(paramsWithCallback(null));
    const { container } = render(<LoginPage />);

    const emailField = container.querySelector('input[type="email"]')!;
    fireEvent.change(emailField, { target: { value: "not-an-email" } });
    fireEvent.blur(emailField);

    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
  });

  it("signs in and redirects to the callbackUrl on success", async () => {
    searchParamsMock.mockReturnValue(paramsWithCallback("/dashboard/foo"));
    signInMock.mockResolvedValue({ error: undefined });
    const { container } = render(<LoginPage />);

    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "sam@example.com" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith("credentials", {
        email: "sam@example.com",
        password: "correct-password",
        redirect: false,
      })
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard/foo"));
  });

  it("defaults to /dashboard when no callbackUrl is present", async () => {
    searchParamsMock.mockReturnValue(paramsWithCallback(null));
    signInMock.mockResolvedValue({ error: undefined });
    const { container } = render(<LoginPage />);

    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "sam@example.com" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("says to wait, not that the password is wrong, when sign-in is rate limited", async () => {
    searchParamsMock.mockReturnValue(paramsWithCallback(null));
    signInMock.mockResolvedValue({ error: "CredentialsSignin", code: "rate_limited" });
    const { container } = render(<LoginPage />);

    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "sam@example.com" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "right-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(screen.getByText("Too many sign-in attempts. Wait a minute and try again.")).toBeInTheDocument());
    expect(screen.queryByText("Invalid email or password.")).not.toBeInTheDocument();
  });

  it("shows an error message and does not redirect when credentials are invalid", async () => {
    searchParamsMock.mockReturnValue(paramsWithCallback(null));
    signInMock.mockResolvedValue({ error: "CredentialsSignin" });
    const { container } = render(<LoginPage />);

    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "sam@example.com" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(screen.getByText("Invalid email or password.")).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not call signIn when the form is submitted while invalid", () => {
    searchParamsMock.mockReturnValue(paramsWithCallback(null));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("does not follow a callbackUrl pointing at another site", async () => {
    searchParamsMock.mockReturnValue(paramsWithCallback("https://evil.example/phish"));
    signInMock.mockResolvedValue({ error: null });
    const { container } = render(<LoginPage />);

    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "sam@example.com" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("hides the contact-support route until a sign-in attempt fails", () => {
    searchParamsMock.mockReturnValue(paramsWithCallback(null));
    render(<LoginPage />);
    expect(screen.queryByText(/Still can't sign in/)).not.toBeInTheDocument();
  });

  it("offers a support form after a failed sign-in and files it as a login request", async () => {
    searchParamsMock.mockReturnValue(paramsWithCallback(null));
    signInMock.mockResolvedValue({ error: "CredentialsSignin" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: "SUP-3" })));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<LoginPage />);

    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "sam@example.com" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    fireEvent.click(await screen.findByRole("button", { name: "Contact support" }));
    // The form starts from the email they just tried to sign in with.
    expect(screen.getByLabelText("Your account email")).toHaveValue("sam@example.com");
    fireEvent.change(screen.getByLabelText("What happens when you try to sign in?"), {
      target: { value: "Password reset email never arrives" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to support" }));

    await waitFor(() => expect(screen.getByText(/Request sent \(SUP-3\)/)).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/support/case");
    expect(JSON.parse(init.body)).toMatchObject({
      category: "login",
      email: "sam@example.com",
      details: "Password reset email never arrives",
    });
    vi.unstubAllGlobals();
  });

  it("shows the support route straight away when linked with ?support=1", () => {
    searchParamsMock.mockReturnValue({ get: (key: string) => (key === "support" ? "1" : null) });
    render(<LoginPage />);
    expect(screen.getByText(/Still can't sign in/)).toBeInTheDocument();
  });
});
