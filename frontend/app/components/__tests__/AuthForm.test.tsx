import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { Button, ErrorNotice, Field, StatusMessage, errorMessage, postJson, useTokenLookup } from "../AuthForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

describe("AuthForm components", () => {
  it("ErrorNotice renders only when there's a message", () => {
    const { container, rerender } = render(<ErrorNotice message={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ErrorNotice message="nope" />);
    expect(screen.getByText("nope")).toBeInTheDocument();
  });

  it("StatusMessage shows its text", () => {
    render(<StatusMessage tone="danger">Broken link</StatusMessage>);
    expect(screen.getByText("Broken link")).toBeInTheDocument();
  });

  it("Field reports typed values and is labelled by its placeholder", () => {
    const onChange = vi.fn();
    render(<Field type="password" placeholder="Password" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
    expect(onChange).toHaveBeenCalledWith("hunter22");
  });

  it("Button is a plain button by default and can be disabled", () => {
    const onClick = vi.fn();
    render(<Button label="Go" onClick={onClick} disabled />);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toBeDisabled();
  });
});

describe("errorMessage", () => {
  it("uses an Error's message, else stringifies", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});

describe("postJson", () => {
  it("POSTs JSON and returns the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(postJson("/api/x", { a: 1 }, "failed")).resolves.toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", expect.objectContaining({ method: "POST", body: '{"a":1}' }));
  });

  it("throws the server's error, or the fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "taken" }, false)));
    await expect(postJson("/api/x", {}, "failed")).rejects.toThrow("taken");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error("not json"); } }));
    await expect(postJson("/api/x", {}, "failed")).rejects.toThrow("failed");
  });
});

describe("useTokenLookup", () => {
  it("reports a missing token without fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTokenLookup("/api/x", "", "missing", "invalid"));
    expect(result.current).toEqual({ data: null, loadError: "missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the token's details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ email: "a@b.co" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTokenLookup("/api/x", "t 1", "missing", "invalid"));
    await waitFor(() => expect(result.current.data).toEqual({ email: "a@b.co" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/x?token=t%201");
  });

  it("surfaces the server's error, or the invalid-link message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));
    const { result } = renderHook(() => useTokenLookup("/api/x", "t", "missing", "invalid"));
    await waitFor(() => expect(result.current.loadError).toBe("invalid"));
  });
});
