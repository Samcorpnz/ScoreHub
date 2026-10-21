"use client";

import { useState } from "react";
import { DisplayOutputKey, DisplayTheme, MatchState, OutputStyle, DEFAULT_DISPLAY_THEME } from "../../types";
import { RELAY_URL } from "../lib/relay";
import { resolveDisplayAssetUrl } from "../../hooks/useDisplayTheme";
import { Card, LogoUploadCard } from "./primitives";

// Graphics add-on: per-output overrides on top of the match-wide Theme tab.
// Anything left unset here follows the Theme tab.

const OUTPUTS: { key: DisplayOutputKey; label: string; hasBackground: boolean }[] = [
  { key: "fullscreen", label: "Fullscreen", hasBackground: true },
  { key: "basic", label: "Basic", hasBackground: true },
  { key: "advanced", label: "Advanced", hasBackground: true },
  { key: "overlay", label: "Lower-third", hasBackground: false },
  { key: "scorebug", label: "Scorebug", hasBackground: false },
];

const SIZES: { field: "scoreScale" | "clockScale" | "nameScale" | "periodScale"; label: string }[] = [
  { field: "scoreScale", label: "Scores" },
  { field: "clockScale", label: "Clock" },
  { field: "nameScale", label: "Team names" },
  { field: "periodScale", label: "Period" },
];

export function OutputStylesCard({ state, push, controlToken }: {
  readonly state: MatchState;
  readonly push: (p: Partial<MatchState>) => void;
  readonly controlToken: string;
}) {
  const [selected, setSelected] = useState<DisplayOutputKey>("fullscreen");
  const theme: DisplayTheme = state.displayTheme ?? { ...DEFAULT_DISPLAY_THEME };
  const outputs = theme.outputs ?? {};
  const style: OutputStyle = outputs[selected] ?? {};
  const output = OUTPUTS.find(o => o.key === selected)!;

  const setOutputs = (next: DisplayTheme["outputs"]) => push({ displayTheme: { ...theme, outputs: next } });
  const update = (patch: Partial<OutputStyle>) => setOutputs({ ...outputs, [selected]: { ...style, ...patch } });
  const reset = () => {
    const { [selected]: _removed, ...rest } = outputs;
    setOutputs(rest);
  };

  const backgroundColor = style.backgroundColor || theme.backgroundColor || DEFAULT_DISPLAY_THEME.backgroundColor;

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }} data-testid="output-styles">
      <div>
        <p className="font-bold text-base" style={{ color: "var(--text-primary)" }}>Customise each output</p>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
          Give each output its own font, sizes and background. Anything you leave blank follows the Theme tab.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap" role="tablist">
        {OUTPUTS.map(o => {
          const active = o.key === selected;
          const customised = Object.keys(outputs[o.key] ?? {}).length > 0;
          return (
            <button
              key={o.key}
              role="tab"
              aria-selected={active}
              data-testid={`output-style-tab-${o.key}`}
              className="rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{
                background: active ? "var(--accent-dim)" : "var(--bg-elevated)",
                border: `1px solid ${active ? "var(--border-accent)" : "var(--border)"}`,
                color: active ? "var(--accent)" : "var(--text-secondary)",
              }}
              onClick={() => setSelected(o.key)}
            >
              {o.label}{customised ? " •" : ""}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card title="Font">
          <input
            className="w-full rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            value={style.font ?? ""}
            placeholder={theme.font ? `Theme font: ${theme.font}` : "Any Google Font, e.g. Bebas Neue"}
            data-testid="output-style-font"
            onChange={e => update({ font: e.target.value })}
          />
        </Card>

        {output.hasBackground ? (
          <Card title="Background colour">
            <input
              type="color"
              className="rounded-lg w-full h-10 cursor-pointer"
              style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
              value={backgroundColor}
              data-testid="output-style-background-color"
              onChange={e => update({ backgroundColor: e.target.value })}
            />
            {style.backgroundColor && (
              <button className="mt-2 text-xs" style={{ color: "var(--text-dim)" }} onClick={() => update({ backgroundColor: "" })}>
                Use theme colour
              </button>
            )}
          </Card>
        ) : (
          <Card title="Background">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Stays transparent for OBS and vMix. For a hardware switcher, use the green or blue key link above.
            </p>
          </Card>
        )}
      </div>

      <Card title="Text sizes">
        <div className="space-y-3">
          {SIZES.map(({ field, label }) => {
            const value = style[field] ?? 1;
            return (
              <div key={field} className="flex items-center gap-3">
                <span className="text-xs w-24" style={{ color: "var(--text-secondary)" }}>{label}</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={value}
                  aria-label={`${label} size`}
                  data-testid={`output-style-${field}`}
                  className="flex-1"
                  onChange={e => update({ [field]: Number.parseFloat(e.target.value) })}
                />
                <code className="text-xs font-mono w-12 text-right" style={{ color: "var(--accent)" }}>{value.toFixed(2)}×</code>
              </div>
            );
          })}
        </div>
      </Card>

      {output.hasBackground && (
        <OutputBackgroundUploader
          output={selected}
          imageUrl={style.backgroundImageUrl ?? ""}
          controlToken={controlToken}
          onChange={backgroundImageUrl => update({ backgroundImageUrl })}
        />
      )}

      <div className="flex justify-end">
        <button
          className="rounded-lg px-3 py-1.5 text-xs font-semibold"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          onClick={reset}
          data-testid="output-style-reset"
        >
          Reset {output.label} to theme
        </button>
      </div>
    </div>
  );
}

function OutputBackgroundUploader({ output, imageUrl, controlToken, onChange }: {
  readonly output: DisplayOutputKey;
  readonly imageUrl: string;
  readonly controlToken: string;
  readonly onChange: (url: string) => void;
}) {
  // The relay stores the image and sets it on the theme itself; onChange
  // just keeps this panel in step until the new state arrives.
  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append("background", file);
    const res = await fetch(`${RELAY_URL}/api/display-background?output=${output}`, {
      method: "POST",
      headers: { "x-control-secret": controlToken },
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    const { backgroundImageUrl } = await res.json();
    onChange(backgroundImageUrl);
  };

  const handleRemove = async () => {
    await fetch(`${RELAY_URL}/api/display-background?output=${output}`, {
      method: "DELETE",
      headers: { "x-control-secret": controlToken },
    });
    onChange("");
  };

  return (
    <Card title="Background image">
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Only for this output, over its background colour. A 1920×1080 JPG or PNG, up to 5 MB.
      </p>
      <LogoUploadCard
        testId={`output-background-${output}`}
        logoSrc={imageUrl ? resolveDisplayAssetUrl(imageUrl) : null}
        alt={`${output} background`}
        activeBorderColor="rgba(0,200,255,0.3)"
        onUpload={handleUpload}
        onRemove={handleRemove}
      />
    </Card>
  );
}
