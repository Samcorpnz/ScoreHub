"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Card } from "./primitives";
import { RELAY_URL } from "../control/lib/relay";

// The three kinds of long-lived token an Admin or Manager hands to something
// that can't log in: the Bridge app, the Stream Deck plugin, and a
// third-party graphics engine. Each belongs to the org, and the thing holding
// it picks the match from GET /api/matches on the relay — unless the token is
// pinned to one match here, in which case that's the only match it can use.

type TokenType = "BRIDGE" | "CONTROL" | "DATA_FEED";

interface ScopedToken {
  id: string;
  label?: string;
  type: TokenType;
  matchId?: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface MatchOption {
  id: string;
  homeName: string | null;
  visitorName: string | null;
  status: string;
}

async function fetchTokens(orgId: string, type: TokenType): Promise<ScopedToken[]> {
  const res = await fetch(`/api/orgs/${orgId}/tokens`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return (data.tokens || []).filter((t: ScopedToken) => t.type === type);
}

const accentButton = { background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" };
const field = { background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" };

function matchName(m: MatchOption): string {
  return `${m.homeName || "Home"} v ${m.visitorName || "Visitor"}`;
}

// The org's live and upcoming matches, for the "pin to a match" selector.
function useSelectableMatches(orgId: string): MatchOption[] {
  const [matches, setMatches] = useState<MatchOption[]>([]);
  useEffect(() => {
    fetch(`/api/orgs/${orgId}/matches?status=LIVE,SCHEDULED`)
      .then(res => res.ok ? res.json() : { matches: [] })
      .then(data => setMatches(data.matches || []))
      .catch(() => setMatches([]));
  }, [orgId]);
  return matches;
}

function DownloadRow({ title, subtitle, links }: {
  readonly title: string;
  readonly subtitle: string;
  readonly links: readonly { label: string; href: string; download?: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
      <div className="flex-1 min-w-[12rem]">
        <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>{subtitle}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        {links.map(l => (
          <a
            key={l.label}
            href={l.href}
            {...(l.download ? { download: l.download } : { target: "_blank", rel: "noopener noreferrer" })}
            className="rounded-lg px-3 py-2 text-xs font-bold"
            style={{ ...accentButton, textDecoration: "none" }}
          >
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// Generate / list / revoke for one token type, with an optional pin to one
// match. Only mounted once the card knows the org may have this token type,
// so an upgrade prompt fetches nothing.
function TokenManager({ orgId, type, noun, labelPlaceholder, revokeWarning }: {
  readonly orgId: string;
  readonly type: TokenType;
  readonly noun: string;
  readonly labelPlaceholder: string;
  readonly revokeWarning: string;
}) {
  const { data: tokens = [], isLoading: loading, error: loadError, mutate: loadTokens } = useSWR(
    [orgId, "tokens", type],
    () => fetchTokens(orgId, type),
  );
  const matches = useSelectableMatches(orgId);
  const [label, setLabel] = useState("");
  const [pinnedMatchId, setPinnedMatchId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [error, setError] = useState("");

  const generateToken = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`/api/orgs/${orgId}/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined, type, matchId: pinnedMatchId || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { token } = await res.json();
      setJustCreated(token);
      setLabel("");
      setPinnedMatchId("");
      await loadTokens();
    } catch {
      setError("Failed to generate token");
    } finally {
      setGenerating(false);
    }
  };

  const revokeToken = async (tokenId: string) => {
    if (!confirm(revokeWarning)) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/tokens/${tokenId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await loadTokens();
    } catch {
      setError("Failed to revoke token");
    }
  };

  // A token pinned to a match that has since ended won't be in `matches`.
  const scopeLabel = (t: ScopedToken) => {
    if (!t.matchId) return "All matches";
    const m = matches.find(x => x.id === t.matchId);
    return m ? `Pinned to ${matchName(m)}` : "Pinned to one match";
  };

  return (
    <>
      {justCreated && (
        <div className="mb-3 p-3 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-accent)" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--accent)" }}>
            Copy this now — it won&apos;t be shown again:
          </p>
          <div className="flex gap-2">
            <code className="text-xs flex-1 min-w-0 p-2 rounded overflow-x-auto" style={{ background: "var(--bg-base)", color: "var(--accent)" }}>
              {justCreated}
            </code>
            <button
              className="rounded-lg px-3 text-xs font-semibold shrink-0"
              style={accentButton}
              onClick={() => navigator.clipboard.writeText(justCreated)}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 mb-3">
        <input
          type="text"
          aria-label="Token label"
          placeholder={labelPlaceholder}
          className="min-w-0 rounded-lg px-3 py-2 text-sm"
          style={field}
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <select
          aria-label="Pin to match"
          className="min-w-0 rounded-lg px-3 py-2 text-sm"
          style={field}
          value={pinnedMatchId}
          onChange={e => setPinnedMatchId(e.target.value)}
        >
          <option value="">All matches</option>
          {matches.map(m => (
            <option key={m.id} value={m.id}>
              {matchName(m)} ({m.status === "LIVE" ? "live" : "scheduled"})
            </option>
          ))}
        </select>
        <button
          className="rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap"
          style={accentButton}
          onClick={generateToken}
          disabled={generating}
        >
          {generating ? "Generating…" : "Generate Token"}
        </button>
      </div>

      {(error || loadError) && <p className="text-xs mb-3" style={{ color: "#EF4444" }}>{error || `Failed to load ${noun} tokens`}</p>}

      {(() => {
        if (loading) return <p className="text-xs" style={{ color: "var(--text-dim)" }}>Loading…</p>;
        if (tokens.length === 0) return <p className="text-xs" style={{ color: "var(--text-dim)" }}>No {noun} tokens yet.</p>;
        return (
        <div className="space-y-1.5">
          {tokens.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded" style={{ background: "var(--bg-elevated)" }}>
              <div className="min-w-0">
                <div style={{ color: "var(--text-primary)" }}>{t.label || "Unlabeled"}</div>
                <div style={{ color: "var(--text-dim)" }}>
                  {scopeLabel(t)} · {new Date(t.createdAt).toLocaleDateString()}
                </div>
              </div>
              {t.revokedAt ? (
                <span style={{ color: "var(--text-dim)" }}>Revoked</span>
              ) : (
                <button
                  className="rounded px-2 py-1 shrink-0"
                  style={{ color: "#EF4444", border: "1px solid #EF444433" }}
                  onClick={() => revokeToken(t.id)}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
        );
      })()}
    </>
  );
}

function AddOnPrompt({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <Card title={title}>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{children}</p>
      <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
        An Admin can add it under <strong>Add-ons</strong> below.
      </p>
    </Card>
  );
}

// Bridging is part of the Data Feed add-on (SA-114) — POST
// /api/orgs/[orgId]/tokens 403s a BRIDGE request without it and the relay
// refuses the bridge's connection, so `dataFeedEntitled` (from the page's
// billing status; null while loading) swaps in the upgrade prompt rather than
// a form that would just fail.
export function BridgeTokensCard({ orgId, dataFeedEntitled }: { readonly orgId: string; readonly dataFeedEntitled: boolean | null }) {
  if (dataFeedEntitled === null) return null;
  if (!dataFeedEntitled) {
    return (
      <AddOnPrompt title="Bridge Devices">
        Score from a physical Saturn/Vega scoreboard console or a ChampionData feed at the venue —
        requires the Data Feed add-on.
      </AddOnPrompt>
    );
  }
  return (
    <Card title="Bridge Devices">
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Generate a token for each venue laptop running the Bridge app and paste it into the
        app&apos;s <strong>Bridge Secret</strong> field. The operator then picks the match in the
        Bridge app.
      </p>
      <DownloadRow
        title="ScoreHub Bridge app"
        subtitle="Install on the venue laptop."
        links={[
          { label: "Mac", href: "https://downloads.scorehub.co.nz/mac" },
          { label: "Windows", href: "https://downloads.scorehub.co.nz/windows" },
        ]}
      />
      <TokenManager
        orgId={orgId}
        type="BRIDGE"
        noun="bridge"
        labelPlaceholder="Label (e.g. Venue laptop 1)"
        revokeWarning="Revoke this bridge token? Any venue laptop using it will lose connection until reconfigured with a new one."
      />
    </Card>
  );
}

// Stream Deck tokens are ungated by design — every plan can use the Control
// API. The per-match endpoint URLs stay on the match's Settings tab, since
// they carry that match's ID.
export function StreamDeckTokensCard({ orgId }: { readonly orgId: string }) {
  return (
    <Card title="Stream Deck / Control API">
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Generate a token, paste it into the Stream Deck plugin&apos;s settings, and pick the match
        there. For your own HTTP calls, each match&apos;s endpoint URLs are on its control
        panel&apos;s <strong>Settings</strong> tab.
      </p>
      <DownloadRow
        title="ScoreHub Stream Deck Plugin"
        subtitle="Double-click to install. Live score on every button."
        links={[{ label: "Download", href: "/scorehub.streamDeckPlugin", download: "scorehub.streamDeckPlugin" }]}
      />
      <TokenManager
        orgId={orgId}
        type="CONTROL"
        noun="Stream Deck"
        labelPlaceholder="Label (e.g. Court 1 Stream Deck)"
        revokeWarning="Revoke this Stream Deck token? Anything using it will stop working until given a new one."
      />
    </Card>
  );
}

// Third-party integrations (Singular.live, VIZRT) authenticate with a
// DATA_FEED token against the relay's /api/data-feed/* routes and the
// "data-feed" socket role — see relay/src/auth.ts's verifyDataFeedSecret.
// Gated on the Data Feed add-on like BridgeTokensCard.
export function DataFeedTokensCard({ orgId, dataFeedEntitled }: { readonly orgId: string; readonly dataFeedEntitled: boolean | null }) {
  if (dataFeedEntitled === null) return null;
  if (!dataFeedEntitled) {
    return (
      <AddOnPrompt title="Data Feed Integrations">
        Pipe live match state into a third-party graphics engine (Singular.live, Chyron, VIZRT) —
        requires the Data Feed add-on.
      </AddOnPrompt>
    );
  }
  return (
    <Card title="Data Feed Integrations">
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Generate a token for a third-party graphics engine (Singular.live, Chyron, VIZRT) and send it
        as the <code>x-data-feed-secret</code> header. It lists the matches it can read
        at <code>{`${RELAY_URL}/api/matches`}</code>, then reads one
        from <code>{`${RELAY_URL}/api/data-feed/state?matchId=…`}</code>.
      </p>
      <TokenManager
        orgId={orgId}
        type="DATA_FEED"
        noun="data feed"
        labelPlaceholder="Label (e.g. Singular.live)"
        revokeWarning="Revoke this data feed token? Any third-party integration using it will lose access until reconfigured with a new one."
      />
    </Card>
  );
}
