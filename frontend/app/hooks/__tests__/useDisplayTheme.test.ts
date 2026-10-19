import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDisplayTheme } from "../useDisplayTheme";
import { DEFAULT_DISPLAY_THEME } from "../../types";

describe("useDisplayTheme", () => {
  describe("per-output overrides (Graphics add-on)", () => {
    const theme = {
      ...DEFAULT_DISPLAY_THEME,
      font: "Inter",
      backgroundColor: "#111111",
      outputs: { fullscreen: { font: "Anton", backgroundColor: "#222222", scoreScale: 1.5, clockScale: 0.8 } },
    };

    it("applies the named output's font, background and sizes", () => {
      const { result } = renderHook(() => useDisplayTheme(theme, "fullscreen"));
      expect(result.current.fontFamily).toBe('"Anton", sans-serif');
      expect(result.current.backgroundColor).toBe("#222222");
      expect(result.current["--score-scale"]).toBe("1.5");
      expect(result.current["--clock-scale"]).toBe("0.8");
      expect(result.current["--name-scale"]).toBe("1");
    });

    it("leaves other outputs on the match-wide theme", () => {
      const { result } = renderHook(() => useDisplayTheme(theme, "basic"));
      expect(result.current.fontFamily).toBe('"Inter", sans-serif');
      expect(result.current.backgroundColor).toBe("#111111");
      expect(result.current["--score-scale"]).toBe("1");
    });
  });

  it("falls back to DEFAULT_DISPLAY_THEME when no theme is supplied", () => {
    const { result } = renderHook(() => useDisplayTheme(undefined));
    expect(result.current.backgroundColor).toBe(DEFAULT_DISPLAY_THEME.backgroundColor);
    expect(result.current["--accent"]).toBe(DEFAULT_DISPLAY_THEME.primaryColor);
  });

  it("uses the supplied theme's colors and derives CSS variables", () => {
    const { result } = renderHook(() =>
      useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, primaryColor: "#ff0000", backgroundColor: "#000000" }),
    );
    expect(result.current.backgroundColor).toBe("#000000");
    expect(result.current["--accent"]).toBe("#ff0000");
    expect(result.current["--accent-dim"]).toBe("#ff000022");
    expect(result.current["--border-accent"]).toBe("#ff000044");
  });

  it("falls back to default colors when primaryColor/backgroundColor are empty strings", () => {
    const { result } = renderHook(() =>
      useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, primaryColor: "", backgroundColor: "" }),
    );
    expect(result.current.backgroundColor).toBe(DEFAULT_DISPLAY_THEME.backgroundColor);
    expect(result.current["--accent"]).toBe(DEFAULT_DISPLAY_THEME.primaryColor);
  });

  it("passes through an explicit textScale", () => {
    const { result } = renderHook(() =>
      useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, textScale: 1.5 }),
    );
    expect(result.current.textScale).toBe(1.5);
    expect(result.current["--text-scale"]).toBe("1.5");
  });

  it("leaves fontFamily undefined when no font is set", () => {
    const { result } = renderHook(() =>
      useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, font: "" }),
    );
    expect(result.current.fontFamily).toBeUndefined();
  });

  it("sets fontFamily and injects a Google Fonts stylesheet link when a font is set", () => {
    const { result } = renderHook(() =>
      useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, font: "Oswald" }),
    );
    expect(result.current.fontFamily).toBe('"Oswald", sans-serif');
    const link = document.head.querySelector('link[href*="Oswald"]');
    expect(link).not.toBeNull();
  });

  it("does not inject a duplicate stylesheet link when the font is unchanged across rerenders", () => {
    const before = document.head.querySelectorAll('link[href*="Montserrat"]').length;
    const { rerender } = renderHook(
      ({ font }) => useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, font }),
      { initialProps: { font: "Montserrat" } },
    );
    rerender({ font: "Montserrat" });
    const after = document.head.querySelectorAll('link[href*="Montserrat"]').length;
    expect(after).toBe(before + 1);
  });

  it("defaults competitionLogoUrl to an empty string when unset", () => {
    const { result } = renderHook(() =>
      useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, competitionLogoUrl: "" }),
    );
    expect(result.current.competitionLogoUrl).toBe("");
  });

  it("leaves the panels solid and adds no background image by default", () => {
    const { result } = renderHook(() => useDisplayTheme(DEFAULT_DISPLAY_THEME));
    expect(result.current).not.toHaveProperty("--bg-surface");
    expect(result.current).not.toHaveProperty("backgroundImage");
  });

  it("makes the panel colours translucent for a panel opacity below 1", () => {
    const { result } = renderHook(() => useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, panelOpacity: 0.4 }));
    const style = result.current as unknown as Record<string, string>;
    expect(style["--bg-surface"]).toBe("rgba(13, 17, 32, 0.4)");
    expect(style["--bg-elevated"]).toBe("rgba(20, 24, 38, 0.4)");
  });

  it("covers the display with the background image, resolving a relay-stored path", () => {
    const { result } = renderHook(() =>
      useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, backgroundImageUrl: "/logos/org/background-m1.jpg?t=1" }),
    );
    expect(result.current.backgroundImage).toBe('url("http://localhost:4000/logos/org/background-m1.jpg?t=1")');
    expect(result.current.backgroundSize).toBe("cover");
  });

  it("quotes a background URL so it can't break out of url()", () => {
    const { result } = renderHook(() =>
      useDisplayTheme({ ...DEFAULT_DISPLAY_THEME, backgroundImageUrl: 'https://cdn.example.com/a") ; x:(' }),
    );
    expect(result.current.backgroundImage).toBe('url("https://cdn.example.com/a\\") ; x:(")');
  });
});
