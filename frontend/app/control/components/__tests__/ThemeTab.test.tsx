import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ThemeTab } from "../ThemeTab";
import { DEFAULT_MATCH_STATE } from "../../../types";
import type { MatchState } from "@scorehub/types";

function makeState(): MatchState {
  return { ...DEFAULT_MATCH_STATE } as MatchState;
}

describe("ThemeTab — competition logo uploader", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(cleanup);

  it("uploads a competition logo and updates the theme", async () => {
    const push = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "",
      json: async () => ({ competitionLogoUrl: "/logos/comp.png" }),
    });

    render(<ThemeTab state={makeState()} push={push} controlToken="tok" />);

    const input = screen.getByTestId("competition-logo-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "logo.png", { type: "image/png" })] } });

    await waitFor(() => expect(push).toHaveBeenCalled());

    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:4000/api/competition-logo");
    expect(opts.method).toBe("POST");
    expect(opts.headers["x-control-secret"]).toBe("tok");
    expect(push).toHaveBeenCalledWith({
      displayTheme: { ...DEFAULT_MATCH_STATE.displayTheme, competitionLogoUrl: "/logos/comp.png" },
    });
  });

  it("removes the competition logo", async () => {
    const push = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const state = {
      ...makeState(),
      displayTheme: { ...DEFAULT_MATCH_STATE.displayTheme, competitionLogoUrl: "/logos/comp.png" },
    };

    render(<ThemeTab state={state} push={push} controlToken="tok" />);

    fireEvent.click(screen.getByTestId("competition-logo-remove-button"));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith({ displayTheme: { ...state.displayTheme, competitionLogoUrl: "" } })
    );

    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:4000/api/competition-logo");
    expect(opts.method).toBe("DELETE");
  });
});

describe("ThemeTab — display background and panel transparency", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(cleanup);

  it("uploads a background image and sets it on the theme", async () => {
    const push = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "",
      json: async () => ({ backgroundImageUrl: "/logos/org/background-m1.jpg?t=1" }),
    });

    render(<ThemeTab state={makeState()} push={push} controlToken="tok" />);
    const input = screen.getByTestId("background-image-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "bg.jpg", { type: "image/jpeg" })] } });

    await waitFor(() => expect(push).toHaveBeenCalled());
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:4000/api/display-background");
    expect(opts.method).toBe("POST");
    expect((opts.body as FormData).get("background")).toBeInstanceOf(File);
    expect(push).toHaveBeenCalledWith({
      displayTheme: { ...DEFAULT_MATCH_STATE.displayTheme, backgroundImageUrl: "/logos/org/background-m1.jpg?t=1" },
    });
  });

  it("removes the background image", async () => {
    const push = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const state = { ...makeState(), displayTheme: { ...DEFAULT_MATCH_STATE.displayTheme, backgroundImageUrl: "/logos/org/bg.jpg" } };

    render(<ThemeTab state={state} push={push} controlToken="tok" />);
    fireEvent.click(screen.getByTestId("background-image-remove-button"));

    await waitFor(() => expect(push).toHaveBeenCalledWith({ displayTheme: { ...state.displayTheme, backgroundImageUrl: "" } }));
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe("DELETE");
  });

  it("stores panel transparency as opacity, and previews it", () => {
    const push = vi.fn();
    const state = { ...makeState(), displayTheme: { ...DEFAULT_MATCH_STATE.displayTheme, panelOpacity: 0.5 } };
    render(<ThemeTab state={state} push={push} controlToken="tok" />);

    expect(screen.getByTestId("theme-panel-transparency")).toHaveValue("50");
    expect(screen.getByTestId("theme-preview-panel").style.background).toBe("rgba(13, 17, 32, 0.5)");

    fireEvent.change(screen.getByTestId("theme-panel-transparency"), { target: { value: "25" } });
    expect(push).toHaveBeenLastCalledWith({ displayTheme: { ...state.displayTheme, panelOpacity: 0.75 } });

    fireEvent.click(screen.getByText("0%", { selector: "button" }));
    expect(push).toHaveBeenLastCalledWith({ displayTheme: { ...state.displayTheme, panelOpacity: 1 } });
  });
});
