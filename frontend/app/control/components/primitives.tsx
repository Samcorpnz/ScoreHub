"use client";

import { useRef, useState } from "react";
import Image from "next/image";

export { Card, SectionLabel, SmallBtn } from "../../components/primitives";

// Shared drop-zone + upload/remove UI for team and competition logos (LogosTab,
// ThemeTab). Callers own the actual upload/remove network calls and where the
// resulting logoUrl gets stored — this only owns the local uploading/error
// state and the file-picker/drag-drop interaction.
export function LogoUploadCard({ testId, logoSrc, alt, activeBorderColor, onUpload, onRemove }: {
  readonly testId: string;
  readonly logoSrc: string | null;
  readonly alt: string;
  readonly activeBorderColor?: string;
  readonly onUpload: (file: File) => Promise<void>;
  readonly onRemove: () => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadButtonLabel = logoSrc ? "Replace Logo" : "Upload Logo";

  const handleFile = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      await onUpload(file);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    try {
      await onRemove();
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="flex items-center justify-center rounded-xl w-full"
        style={{
          height: 140, background: "var(--bg-elevated)",
          border: `1px dashed ${logoSrc ? (activeBorderColor ?? "var(--border-accent)") : "var(--border)"}`,
          cursor: "pointer",
        }}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        {logoSrc ? (
          <div data-testid={`${testId}-preview`} style={{ position: "relative", height: 110, width: "80%" }}>
            <Image src={logoSrc} alt={alt} fill style={{ objectFit: "contain" }} />
          </div>
        ) : (
          <div className="text-center">
            <p className="text-2xl mb-1">⬆</p>
            <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>Click or drag to upload</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>PNG, JPG, SVG, WebP — max 5 MB</p>
          </div>
        )}
      </button>

      <input ref={inputRef} data-testid={`${testId}-input`} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

      {error && <p data-testid={`${testId}-error`} className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid={`${testId}-upload-button`}
          className="flex-1 rounded-lg py-2 text-sm font-bold"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : uploadButtonLabel}
        </button>
        {logoSrc && (
          <button
            type="button"
            data-testid={`${testId}-remove-button`}
            className="rounded-lg px-4 py-2 text-sm font-bold"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--danger)" }}
            onClick={handleRemove}
            disabled={uploading}
          >
            Remove
          </button>
        )}
      </div>
    </>
  );
}

export function TemplateRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

export function ColorSwatch({ color }: { readonly color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div style={{ width: 32, height: 32, borderRadius: 8, background: color, boxShadow: `0 0 12px ${color}88` }} />
      <code className="text-sm font-mono" style={{ color: "var(--text-secondary)" }}>{color}</code>
    </div>
  );
}

export function ScoreButtons({ score, onAdjust, scoreIncrements, scoreLabels, testIdPrefix }: {
  readonly score: number;
  readonly onAdjust: (d: number) => void;
  readonly scoreIncrements: number[];
  readonly scoreLabels?: string[];
  readonly testIdPrefix?: string;
}) {
  const compact = scoreIncrements.length > 2;
  const btnClass = `rounded-xl py-4 font-black ${compact ? "text-lg" : "text-xl"}`;
  const scoreClass = `text-center score-digit ${compact ? "text-4xl" : "text-5xl"}`;
  // Buttons and their labels share one grid — −buttons, score, +buttons — so
  // each label sits under its own + button whatever the button count. The −
  // buttons mirror the + ones, so they go unlabelled to keep the row quiet.
  const n = scoreIncrements.length;
  const columns = `repeat(${n}, minmax(0, 1fr)) ${compact ? "3.5rem" : "minmax(0, 1fr)"} repeat(${n}, minmax(0, 1fr))`;
  const decrements = [...scoreIncrements].reverse();
  // Columns are narrow: let "CONV/PEN" wrap after its slash rather than mid-word.
  const increments = scoreIncrements.map((d, i) => ({ d, label: scoreLabels?.[i]?.replaceAll("/", "/​") }));
  const labelClass = "text-[10px] font-semibold tracking-wide text-center leading-tight";

  return (
    <div className="grid gap-x-2 gap-y-1 mt-3 items-center" style={{ gridTemplateColumns: columns }}>
      {decrements.map(d => (
        <button key={-d} className={btnClass}
          data-testid={testIdPrefix ? `${testIdPrefix}-dec-${d}` : undefined}
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          onClick={() => onAdjust(-d)}>−{d}</button>
      ))}
      <div className={scoreClass} style={{ color: "var(--accent)" }}>{score}</div>
      {increments.map(({ d }) => (
        <button key={d} className={btnClass}
          data-testid={testIdPrefix ? `${testIdPrefix}-inc-${d}` : undefined}
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
          onClick={() => onAdjust(d)}>+{d}</button>
      ))}
      {scoreLabels && (
        <>
          {decrements.map(d => <span key={`dec-label-${d}`} aria-hidden />)}
          <span aria-hidden />
          {increments.map(({ d, label }) => (
            <span key={`inc-label-${d}`} className={labelClass} style={{ color: "var(--accent)", opacity: 0.8 }}>{label}</span>
          ))}
        </>
      )}
    </div>
  );
}

export function NameField({ label, value, placeholder, onChange, onCommit, testId }: {
  readonly label: string; readonly value: string; readonly placeholder: string;
  readonly onChange: (v: string) => void; readonly onCommit: () => void; readonly testId?: string;
}) {
  return (
    <div className="mb-3">
      <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>{label}</p>
      <div className="flex gap-2">
        <input className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
          data-testid={testId}
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
          value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onCommit()} />
        <button className="rounded-lg px-3 py-2 text-xs font-bold"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
          onClick={onCommit}>Set</button>
      </div>
    </div>
  );
}

export function ClockAdjustButtons({ clockSeconds, onAdjust }: { readonly clockSeconds: number; readonly onAdjust: (d: number) => void }) {
  const adjustments = [-60, -10, -1, 1, 10, 60];
  return (
    <div className="flex items-center gap-1">
      {adjustments.map(d => (
        <button
          key={d}
          className="rounded-lg py-1.5 text-xs font-black flex-1"
          style={{
            background: d < 0 ? "var(--bg-elevated)" : "var(--accent-dim)",
            border: `1px solid ${d < 0 ? "var(--border)" : "var(--border-accent)"}`,
            color: d < 0 ? "var(--text-secondary)" : "var(--accent)",
          }}
          onClick={() => onAdjust(d)}
        >
          {d > 0 ? "+" : ""}{d < -59 || d > 59 ? `${d / 60}m` : `${d}s`}
        </button>
      ))}
    </div>
  );
}
