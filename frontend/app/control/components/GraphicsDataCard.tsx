"use client";

import { useState } from "react";
import useSWR from "swr";
import { RELAY_URL } from "../lib/relay";

// Graphics add-on "straight data out": a flat scores/names/clock record that
// vMix and OBS data sources (or a spreadsheet) can poll by URL. Backed by
// GET /api/graphics/data on the relay and a read-only GRAPHICS_DATA token.

const FORMATS = [
  { format: "json", label: "JSON", hint: "Most tools, custom HTML" },
  { format: "xml", label: "XML", hint: "vMix Data Sources (XML)" },
  { format: "csv", label: "CSV", hint: "vMix Data Sources (CSV), Excel" },
] as const;

interface TokenRow {
  id: string;
  label: string | null;
  type: string;
  createdAt: string;
  revokedAt: string | null;
}

async function fetchGraphicsDataTokens(orgId: string): Promise<TokenRow[]> {
  const res = await fetch(`/api/orgs/${orgId}/tokens`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return (data.tokens || []).filter((t: TokenRow) => t.type === "GRAPHICS_DATA");
}

export function feedUrl(token: string, format: string, matchId?: string): string {
  const params = new URLSearchParams({ token, format });
  if (matchId) params.set("matchId", matchId);
  return `${RELAY_URL}/api/graphics/data?${params.toString()}`;
}

export function GraphicsDataCard({ orgId, matchId, canManage }: {
  readonly orgId: string;
  readonly matchId?: string;
  readonly canManage: boolean;
}) {
  const [label, setLabel] = useState("");
  const [generating, setGenerating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [error, setError] = useState("");

  const { data: tokens = [], mutate } = useSWR(
    canManage ? [orgId, "tokens", "GRAPHICS_DATA"] : null,
    () => fetchGraphicsDataTokens(orgId),
  );

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`/api/orgs/${orgId}/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined, type: "GRAPHICS_DATA" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { token } = await res.json();
      setJustCreated(token);
      setLabel("");
      await mutate();
    } catch {
      setError("Couldn't generate a data link. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const revoke = async (tokenId: string) => {
    if (!confirm("Revoke this data link? Anything polling it stops getting data.")) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/tokens/${tokenId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await mutate();
    } catch {
      setError("Couldn't revoke that data link. Try again.");
    }
  };

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }} data-testid="graphics-data-card">
      <div>
        <p className="font-bold text-base" style={{ color: "var(--text-primary)" }}>Data out</p>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
          A live URL with scores, team names, period and clock as one flat record. Point a vMix or OBS data
          source at it and bind your own titles to the fields. Poll once a second.
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
          <strong>Clock:</strong> bind to <code>clockDisplay</code> for a ready-to-show time (MM:SS, or SS.t under a
          minute). To run your own timer, use <code>clockSeconds</code>, <code>clockRunning</code>,{" "}
          <code>clockDirection</code> and <code>clockAnchorMs</code>. A polled clock can lag by up to one poll, so for
          a frame-accurate on-screen clock use a key or overlay output instead.
        </p>
      </div>

      {!canManage && (
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          An Admin or Manager creates the data link here.
        </p>
      )}

      {canManage && (
        <>
          {justCreated && (
            <div className="p-3 rounded-lg space-y-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-accent)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                Copy what you need now. The link includes a token that won&apos;t be shown again.
              </p>
              {FORMATS.map(f => (
                <div key={f.format} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{f.label}</span>
                    <span className="text-xs ml-2" style={{ color: "var(--text-dim)" }}>{f.hint}</span>
                  </div>
                  <button
                    className="rounded-lg px-3 py-1 text-xs font-semibold shrink-0"
                    style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
                    data-testid={`graphics-data-copy-${f.format}`}
                    onClick={() => navigator.clipboard.writeText(feedUrl(justCreated, f.format, matchId))}
                  >
                    Copy {f.label} URL
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Label (e.g. vMix main)"
              className="flex-1 rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
            <button
              className="rounded-lg px-3 py-2 text-sm font-semibold shrink-0"
              style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
              onClick={generate}
              disabled={generating}
              data-testid="graphics-data-generate"
            >
              {generating ? "Creating…" : "Create data link"}
            </button>
          </div>

          {error && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}

          {tokens.length > 0 && (
            <div className="space-y-1.5">
              {tokens.map(t => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded" style={{ background: "var(--bg-elevated)" }}>
                  <div>
                    <div style={{ color: "var(--text-primary)" }}>{t.label || "Unlabelled"}</div>
                    <div style={{ color: "var(--text-dim)" }}>{new Date(t.createdAt).toLocaleDateString()}</div>
                  </div>
                  {t.revokedAt ? (
                    <span style={{ color: "var(--text-dim)" }}>Revoked</span>
                  ) : (
                    <button className="rounded px-2 py-1 shrink-0" style={{ color: "var(--danger)", border: "1px solid #EF444433" }} onClick={() => revoke(t.id)}>
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
