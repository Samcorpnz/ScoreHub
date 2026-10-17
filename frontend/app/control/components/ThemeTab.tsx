"use client";

import { useState } from "react";
import Image from "next/image";
import { MatchState, DisplayTheme, DEFAULT_DISPLAY_THEME } from "../../types";
import { RELAY_URL } from "../lib/relay";
import { resolveDisplayAssetUrl } from "../../hooks/useDisplayTheme";
import { Card, ColorSwatch, LogoUploadCard, SectionLabel } from "./primitives";

const FONT_SUGGESTIONS = [
  "Bebas Neue", "Barlow Condensed", "Oswald", "Inter", "Roboto Condensed",
  "Anton", "Rajdhani", "Teko", "Exo 2", "Montserrat",
];

export function ThemeTab({ state, push, controlToken }: { readonly state: MatchState; readonly push: (p: Partial<MatchState>) => void; readonly controlToken: string }) {
  const theme: DisplayTheme = state.displayTheme ?? { ...DEFAULT_DISPLAY_THEME };
  const [showFontSuggestions, setShowFontSuggestions] = useState(false);

  const updateTheme = (patch: Partial<DisplayTheme>) =>
    push({ displayTheme: { ...theme, ...patch } });

  const primaryColor = theme.primaryColor || DEFAULT_DISPLAY_THEME.primaryColor;
  const backgroundColor = theme.backgroundColor || DEFAULT_DISPLAY_THEME.backgroundColor;
  const panelOpacity = theme.panelOpacity ?? 1;
  // Shown to the operator as transparency (0% = solid), stored as opacity
  const transparencyPct = Math.round((1 - panelOpacity) * 100);

  return (
    <div className="space-y-6">
      {/* Live preview */}
      <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <SectionLabel>Preview</SectionLabel>
        <div
          data-testid="theme-preview"
          className="mt-4 rounded-xl flex items-center justify-center py-6 px-4"
          style={{
            backgroundColor,
            ...(theme.backgroundImageUrl && {
              backgroundImage: `url(${JSON.stringify(resolveDisplayAssetUrl(theme.backgroundImageUrl))})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }),
            fontFamily: theme.font ? `"${theme.font}", sans-serif` : undefined,
          }}
        >
          <div
            data-testid="theme-preview-panel"
            className="rounded-xl flex items-center justify-center gap-8 py-4 px-6"
            style={{ background: `rgba(13, 17, 32, ${panelOpacity})` }}
          >
          {theme.competitionLogoUrl && (
            <div style={{ position: "relative", height: 48, width: 48, flexShrink: 0 }}>
              <Image
                src={theme.competitionLogoUrl.startsWith("/logos/") ? `${RELAY_URL}${theme.competitionLogoUrl}` : theme.competitionLogoUrl}
                alt="Competition logo"
                fill
                style={{ objectFit: "contain" }}
              />
            </div>
          )}
          <div className="text-center">
            <p className="font-black" style={{ color: primaryColor, fontSize: `${2.5 * (theme.textScale ?? 1)}rem`, lineHeight: 1 }}>
              {state.home.score}
            </p>
            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: "#ffffff99" }}>
              {state.home.name || "HOME"}
            </p>
          </div>
          <div className="text-center">
            <p className="font-bold" style={{ color: primaryColor, fontSize: `${1.5 * (theme.textScale ?? 1)}rem` }}>
              {String(Math.floor(state.clockSeconds / 60)).padStart(2, "0")}:{String(state.clockSeconds % 60).padStart(2, "0")}
            </p>
            <p className="text-xs font-black tracking-widest mt-1" style={{ color: primaryColor }}>
              QTR {state.period}
            </p>
          </div>
          <div className="text-center">
            <p className="font-black" style={{ color: primaryColor, fontSize: `${2.5 * (theme.textScale ?? 1)}rem`, lineHeight: 1 }}>
              {state.visitor.score}
            </p>
            <p className="text-xs font-bold tracking-widest uppercase mt-1" style={{ color: "#ffffff99" }}>
              {state.visitor.name || "VISITOR"}
            </p>
          </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Primary colour */}
        <Card title="Primary / Accent Colour">
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            Accent colour for clock, period, scoreboard chrome, and highlights across all displays.
          </p>
          <ColorSwatch color={primaryColor} />
          <input
            type="color"
            className="mt-3 rounded-lg w-full h-10 cursor-pointer"
            style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
            value={primaryColor}
            onChange={e => updateTheme({ primaryColor: e.target.value })}
          />
          <div className="flex gap-2 mt-2 flex-wrap">
            {["#00C8FF", "#FFFFFF", "#F59E0B", "#22C55E", "#EF4444", "#A855F7", "#EC4899"].map(c => (
              <button key={c} style={{ width: 28, height: 28, borderRadius: 6, background: c, border: primaryColor === c ? "2px solid white" : "2px solid transparent" }}
                onClick={() => updateTheme({ primaryColor: c })} />
            ))}
          </div>
        </Card>

        {/* Background colour */}
        <Card title="Display Background Colour">
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            Background colour of the scoreboard displays (not the overlay — that stays transparent).
          </p>
          <ColorSwatch color={backgroundColor} />
          <input
            type="color"
            className="mt-3 rounded-lg w-full h-10 cursor-pointer"
            style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
            value={backgroundColor}
            onChange={e => updateTheme({ backgroundColor: e.target.value })}
          />
          <div className="flex gap-2 mt-2 flex-wrap">
            {["#07090F", "#000000", "#0a0a0a", "#0F172A", "#1E1B4B", "#052e16", "#1a0000"].map(c => (
              <button key={c} style={{ width: 28, height: 28, borderRadius: 6, background: c, border: `2px solid ${backgroundColor === c ? "white" : "#ffffff33"}` }}
                onClick={() => updateTheme({ backgroundColor: c })} />
            ))}
          </div>
        </Card>

        {/* Background image */}
        <BackgroundImageUploader theme={theme} updateTheme={updateTheme} controlToken={controlToken} />

        {/* Panel transparency */}
        <Card title="Score Panel Transparency">
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            Lets the background colour or image show through the score panels. 0% is solid.
          </p>
          <div className="flex items-center gap-4 mt-2">
            <span className="text-xs font-mono w-8 text-right" style={{ color: "var(--text-dim)" }}>0%</span>
            <input
              type="range"
              data-testid="theme-panel-transparency"
              aria-label="Score panel transparency"
              min={0}
              max={100}
              step={5}
              value={transparencyPct}
              className="flex-1"
              onChange={e => updateTheme({ panelOpacity: 1 - Number.parseInt(e.target.value, 10) / 100 })}
            />
            <span className="text-xs font-mono w-8" style={{ color: "var(--text-dim)" }}>100%</span>
          </div>
          <div className="flex items-center justify-between mt-3">
            <code className="text-sm font-mono font-bold" style={{ color: "var(--accent)" }}>{transparencyPct}%</code>
            <div className="flex gap-2">
              {[0, 25, 50, 75].map(pct => (
                <button
                  key={pct}
                  className="rounded px-2 py-1 text-xs font-bold"
                  style={{
                    background: transparencyPct === pct ? "var(--accent-dim)" : "var(--bg-elevated)",
                    border: `1px solid ${transparencyPct === pct ? "var(--border-accent)" : "var(--border)"}`,
                    color: transparencyPct === pct ? "var(--accent)" : "var(--text-secondary)",
                  }}
                  onClick={() => updateTheme({ panelOpacity: 1 - pct / 100 })}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Font */}
        <Card title="Display Font">
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            Enter any Google Font name. Leave blank to use the default system font.
          </p>
          <div className="relative">
            <input
              className="w-full rounded-lg px-3 py-2 text-sm font-semibold"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
              value={theme.font}
              placeholder="e.g. Bebas Neue"
              onChange={e => updateTheme({ font: e.target.value })}
              onFocus={() => setShowFontSuggestions(true)}
              onBlur={() => setTimeout(() => setShowFontSuggestions(false), 150)}
            />
            {showFontSuggestions && (
              <div
                className="absolute z-10 w-full mt-1 rounded-lg overflow-hidden"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
              >
                {FONT_SUGGESTIONS.filter(f => f.toLowerCase().includes(theme.font.toLowerCase())).map(f => (
                  <button
                    key={f}
                    className="w-full text-left px-3 py-2 text-sm hover:opacity-80"
                    style={{ color: "var(--text-primary)", background: "transparent", display: "block" }}
                    onMouseDown={() => updateTheme({ font: f })}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
          {theme.font && (
            <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
              Font loaded from Google Fonts automatically on the display pages.
            </p>
          )}
          {theme.font && (
            <button
              className="mt-2 text-xs"
              style={{ color: "var(--text-dim)" }}
              onClick={() => updateTheme({ font: "" })}
            >
              Clear font
            </button>
          )}
        </Card>

        {/* Text scale */}
        <Card title="Text Scale">
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            Scale scores and clock text up or down across all displays.
          </p>
          <div className="flex items-center gap-4 mt-2">
            <span className="text-xs font-mono w-8 text-right" style={{ color: "var(--text-dim)" }}>0.5×</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={theme.textScale ?? 1}
              className="flex-1"
              onChange={e => updateTheme({ textScale: Number.parseFloat(e.target.value) })}
            />
            <span className="text-xs font-mono w-8" style={{ color: "var(--text-dim)" }}>2×</span>
          </div>
          <div className="flex items-center justify-between mt-3">
            <code className="text-sm font-mono font-bold" style={{ color: "var(--accent)" }}>
              {(theme.textScale ?? 1).toFixed(2)}×
            </code>
            <div className="flex gap-2">
              {[0.75, 1, 1.25, 1.5, 1.75].map(s => (
                <button
                  key={s}
                  className="rounded px-2 py-1 text-xs font-bold"
                  style={{
                    background: Math.abs((theme.textScale ?? 1) - s) < 0.01 ? "var(--accent-dim)" : "var(--bg-elevated)",
                    border: `1px solid ${Math.abs((theme.textScale ?? 1) - s) < 0.01 ? "var(--border-accent)" : "var(--border)"}`,
                    color: Math.abs((theme.textScale ?? 1) - s) < 0.01 ? "var(--accent)" : "var(--text-secondary)",
                  }}
                  onClick={() => updateTheme({ textScale: s })}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Competition logo */}
      <CompetitionLogoUploader theme={theme} updateTheme={updateTheme} controlToken={controlToken} />

      {/* Reset */}
      <div className="flex justify-end">
        <button
          className="rounded-lg px-4 py-2 text-sm font-bold"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--danger)" }}
          onClick={() => push({ displayTheme: { ...DEFAULT_DISPLAY_THEME } })}
        >
          Reset Theme to Defaults
        </button>
      </div>
    </div>
  );
}

function BackgroundImageUploader({ theme, updateTheme, controlToken }: {
  readonly theme: DisplayTheme;
  readonly updateTheme: (p: Partial<DisplayTheme>) => void;
  readonly controlToken: string;
}) {
  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append("background", file);
    const res = await fetch(`${RELAY_URL}/api/display-background`, {
      method: "POST",
      headers: { "x-control-secret": controlToken },
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    const { backgroundImageUrl } = await res.json();
    updateTheme({ backgroundImageUrl });
  };

  const handleRemove = async () => {
    await fetch(`${RELAY_URL}/api/display-background`, {
      method: "DELETE",
      headers: { "x-control-secret": controlToken },
    });
    updateTheme({ backgroundImageUrl: "" });
  };

  return (
    <Card title="Display Background Image">
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Fills the full-screen, basic and advanced displays, over the background colour. The overlay,
        score bug and graphics stay transparent for OBS and vMix. A 1920×1080 JPG or PNG, up to 5 MB.
      </p>
      <LogoUploadCard
        testId="background-image"
        logoSrc={theme.backgroundImageUrl ? resolveDisplayAssetUrl(theme.backgroundImageUrl) : null}
        alt="Display background"
        activeBorderColor="rgba(0,200,255,0.3)"
        onUpload={handleUpload}
        onRemove={handleRemove}
      />
    </Card>
  );
}

function CompetitionLogoUploader({ theme, updateTheme, controlToken }: {
  readonly theme: DisplayTheme;
  readonly updateTheme: (p: Partial<DisplayTheme>) => void;
  readonly controlToken: string;
}) {
  let logoSrc: string | null = null;
  if (theme.competitionLogoUrl) {
    logoSrc = theme.competitionLogoUrl.startsWith("/logos/") ? `${RELAY_URL}${theme.competitionLogoUrl}` : theme.competitionLogoUrl;
  }

  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append("logo", file);
    const res = await fetch(`${RELAY_URL}/api/competition-logo`, {
      method: "POST",
      headers: { "x-control-secret": controlToken },
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    const { competitionLogoUrl } = await res.json();
    updateTheme({ competitionLogoUrl });
  };

  const handleRemove = async () => {
    await fetch(`${RELAY_URL}/api/competition-logo`, {
      method: "DELETE",
      headers: { "x-control-secret": controlToken },
    });
    updateTheme({ competitionLogoUrl: "" });
  };

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <SectionLabel>Competition / Event Logo</SectionLabel>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Displayed in the header area of applicable scoreboard outputs. Separate from team logos.
      </p>

      <LogoUploadCard
        testId="competition-logo"
        logoSrc={logoSrc}
        alt="Competition logo"
        activeBorderColor="rgba(0,200,255,0.3)"
        onUpload={handleUpload}
        onRemove={handleRemove}
      />
    </div>
  );
}
