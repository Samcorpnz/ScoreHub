import { useEffect, useRef } from "react";
import { DisplayTheme, DisplayOutputKey, DEFAULT_DISPLAY_THEME } from "../types";
import { RELAY_URL } from "../control/lib/relay";

// Display panels are painted with --bg-surface / --bg-elevated (globals.css);
// these are their RGB values, so panel opacity can be applied to them.
const PANEL_SURFACE_RGB = "13, 17, 32";
const PANEL_ELEVATED_RGB = "20, 24, 38";

// Uploads stored on the relay's own disk come back as a /logos/… path
export function resolveDisplayAssetUrl(url: string): string {
  return url.startsWith("/logos/") ? `${RELAY_URL}${url}` : url;
}

export type DisplayThemeStyle = React.CSSProperties & {
  "--accent": string;
  "--accent-dim": string;
  "--border-accent": string;
  "--bg-base": string;
  "--text-scale": string;
  // Graphics add-on per-element sizes (OutputStyle), 1 when unset
  "--score-scale": string;
  "--clock-scale": string;
  "--name-scale": string;
  "--period-scale": string;
  textScale: number;
  competitionLogoUrl: string;
  // Pages that must stay transparent for OBS/vMix (overlay, score bug,
  // graphics) destructure these out alongside backgroundColor.
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
};

// `output` picks up that output's Graphics add-on overrides (font,
// background, element sizes) on top of the match-wide theme.
export function useDisplayTheme(theme: DisplayTheme | undefined, output?: DisplayOutputKey): DisplayThemeStyle {
  const base = theme ?? DEFAULT_DISPLAY_THEME;
  const override = output ? base.outputs?.[output] : undefined;
  const t: DisplayTheme = {
    ...base,
    font: override?.font || base.font,
    backgroundColor: override?.backgroundColor || base.backgroundColor,
    backgroundImageUrl: override?.backgroundImageUrl || base.backgroundImageUrl,
  };
  const loadedFonts = useRef(new Set<string>());

  useEffect(() => {
    if (!t.font) return;
    if (loadedFonts.current.has(t.font)) return;
    loadedFonts.current.add(t.font);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(t.font)}:wght@400;700;900&display=swap`;
    document.head.appendChild(link);
  }, [t.font]);

  const primaryColor = t.primaryColor || DEFAULT_DISPLAY_THEME.primaryColor;
  const backgroundColor = t.backgroundColor || DEFAULT_DISPLAY_THEME.backgroundColor;

  const textScale = t.textScale ?? 1;
  const panelOpacity = Math.min(1, Math.max(0, t.panelOpacity ?? 1));
  const backgroundImageUrl = t.backgroundImageUrl || "";

  // CSS custom properties override — applied inline on the root wrapper element
  return {
    backgroundColor,
    fontFamily: t.font ? `"${t.font}", sans-serif` : undefined,
    // Override CSS variables used by display components
    "--accent":         primaryColor,
    "--accent-dim":     `${primaryColor}22`,
    "--border-accent":  `${primaryColor}44`,
    "--bg-base":        backgroundColor,
    "--text-scale":     String(textScale),
    "--score-scale":    String(override?.scoreScale ?? 1),
    "--clock-scale":    String(override?.clockScale ?? 1),
    "--name-scale":     String(override?.nameScale ?? 1),
    "--period-scale":   String(override?.periodScale ?? 1),
    textScale,
    competitionLogoUrl: t.competitionLogoUrl || "",
    ...(panelOpacity < 1 && {
      "--bg-surface":  `rgba(${PANEL_SURFACE_RGB}, ${panelOpacity})`,
      "--bg-elevated": `rgba(${PANEL_ELEVATED_RGB}, ${panelOpacity})`,
    }),
    ...(backgroundImageUrl && {
      // JSON.stringify quotes and escapes the URL for CSS url("…")
      backgroundImage: `url(${JSON.stringify(resolveDisplayAssetUrl(backgroundImageUrl))})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    }),
  } as DisplayThemeStyle;
}
