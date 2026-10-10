"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { MatchState } from "../../types";
import { SPORT_TEMPLATES, getTemplate, getStructureLabel } from "../../sport-templates";
import { RELAY_URL } from "../lib/relay";
import { Card, ColorSwatch, TemplateRow } from "./primitives";

interface BridgeToken {
  id: string;
  label?: string;
  type: "BRIDGE" | "CONTROL" | "DATA_FEED";
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

async function fetchTokensByType(orgId: string, type: BridgeToken["type"]): Promise<BridgeToken[]> {
  const res = await fetch(`/api/orgs/${orgId}/tokens`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return (data.tokens || []).filter((t: BridgeToken) => t.type === type);
}

function templateClockLabel(clockSeconds: number, countDown: boolean): string {
  if (clockSeconds === 0) {
    return countDown ? "0:00 (no clock)" : "Counts up from 0:00";
  }
  const direction = countDown ? "Counts down from" : "Counts up from";
  const minutes = Math.floor(clockSeconds / 60);
  const seconds = String(clockSeconds % 60).padStart(2, "0");
  return `${direction} ${minutes}:${seconds}`;
}

function WebhookCard({ orgId, matchId }: { readonly orgId: string; readonly matchId?: string }) {
  const { data: tokens = [], isLoading: loading, error: loadError, mutate: loadTokens } = useSWR(
    [orgId, "tokens", "CONTROL"],
    () => fetchTokensByType(orgId, "CONTROL"),
  );
  const [label, setLabel] = useState("");
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
        body: JSON.stringify({ label: label.trim() || undefined, type: "CONTROL" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { token } = await res.json();
      setJustCreated(token);
      setLabel("");
      await loadTokens();
    } catch {
      setError("Failed to generate token");
    } finally {
      setGenerating(false);
    }
  };

  const revokeToken = async (tokenId: string) => {
    if (!confirm("Revoke this Stream Deck token?")) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/tokens/${tokenId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await loadTokens();
    } catch {
      setError("Failed to revoke token");
    }
  };

  const qMatchId = matchId ? `?matchId=${matchId}` : "";
  const ampMatchId = matchId ? `&matchId=${matchId}` : "";
  const baseUrl = RELAY_URL;

  const actions = [
    { label: "▶ Start",        url: `${baseUrl}/action/start${qMatchId}` },
    { label: "■ Stop",         url: `${baseUrl}/action/stop${qMatchId}` },
    { label: "⏯ Toggle",      url: `${baseUrl}/action/toggle${qMatchId}` },
    { label: "Home +1",        url: `${baseUrl}/action/score/home?delta=1${ampMatchId}` },
    { label: "Home +2",        url: `${baseUrl}/action/score/home?delta=2${ampMatchId}` },
    { label: "Home −1",        url: `${baseUrl}/action/score/home?delta=-1${ampMatchId}` },
    { label: "Visitor +1",     url: `${baseUrl}/action/score/visitor?delta=1${ampMatchId}` },
    { label: "Visitor +2",     url: `${baseUrl}/action/score/visitor?delta=2${ampMatchId}` },
    { label: "Visitor −1",     url: `${baseUrl}/action/score/visitor?delta=-1${ampMatchId}` },
    { label: "Period next",    url: `${baseUrl}/action/period/next${qMatchId}` },
    { label: "Period prev",    url: `${baseUrl}/action/period/prev${qMatchId}` },
    { label: "End period",     url: `${baseUrl}/action/period/end${qMatchId}` },
  ];

  return (
    <Card title="Stream Deck / Webhooks">
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Control ScoreHub from a Stream Deck or any HTTP client. Install the plugin, generate a token,
        paste it into the Stream Deck property inspector, and choose your match there.
      </p>

      {/* Plugin download */}
      <div className="flex items-center gap-3 mb-4 p-3 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="flex-1">
          <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>ScoreHub Stream Deck Plugin</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>Double-click to install. Live score on every button.</p>
        </div>
        <a
          href="/scorehub.streamDeckPlugin"
          download="scorehub.streamDeckPlugin"
          className="rounded-lg px-3 py-2 text-xs font-bold shrink-0"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)", textDecoration: "none" }}
        >
          Download
        </a>
      </div>

      {justCreated && (
        <div className="mb-3 p-3 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-accent)" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--accent)" }}>
            Copy this token now — it won&apos;t be shown again:
          </p>
          <div className="flex gap-2">
            <code className="text-xs flex-1 p-2 rounded overflow-x-auto" style={{ background: "var(--bg-base)", color: "var(--accent)" }}>
              {justCreated}
            </code>
            <button
              className="rounded-lg px-3 text-xs font-semibold shrink-0"
              style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
              onClick={() => navigator.clipboard.writeText(justCreated)}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Label (e.g. Court 1 Stream Deck)"
          className="flex-1 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <button
          className="rounded-lg px-3 py-2 text-sm font-semibold shrink-0"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
          onClick={generateToken}
          disabled={generating}
        >
          {generating ? "Generating…" : "Generate Token"}
        </button>
      </div>

      {(error || loadError) && <p className="text-xs mb-3" style={{ color: "#EF4444" }}>{error || "Failed to load tokens"}</p>}

      {!loading && tokens.length > 0 && (
        <div className="space-y-1 mb-4">
          {tokens.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded" style={{ background: "var(--bg-elevated)" }}>
              <div>
                <span style={{ color: "var(--text-primary)" }}>{t.label || "Unlabeled"}</span>
                <span className="ml-2" style={{ color: "var(--text-dim)" }}>{new Date(t.createdAt).toLocaleDateString()}</span>
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
      )}

      <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>Endpoint URLs</p>
        <div className="space-y-1">
          {actions.map(a => (
            <div key={a.label} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 font-semibold" style={{ color: "var(--text-secondary)" }}>{a.label}</span>
              <code
                className="flex-1 p-1.5 rounded truncate"
                style={{ background: "var(--bg-elevated)", color: "var(--text-dim)" }}
                title={a.url}
              >
                {a.url}
              </code>
              <button
                type="button"
                className="shrink-0 rounded px-2 py-1 text-xs"
                style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
                onClick={() => navigator.clipboard.writeText(a.url)}
              >
                Copy
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
          Click any URL to copy. Set <code>x-control-secret</code> as a custom header in your Stream Deck HTTP action.
        </p>
      </div>
    </Card>
  );
}

// Whether the account has the Data Feed add-on, which covers both console
// bridging and the third-party feed. null while loading.
function useDataFeedEntitled(): boolean | null {
  const [entitled, setEntitled] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/billing/status")
      .then(res => res.ok ? res.json() : { addOns: [] })
      .then(data => setEntitled((data.addOns ?? []).includes("data-feed")))
      .catch(err => {
        console.warn("[SettingsTab] failed to fetch billing status:", err);
        setEntitled(false);
      });
  }, []);
  return entitled;
}

// Bridging a console is part of the Data Feed add-on (SA-114) — POST
// /api/orgs/[orgId]/tokens 403s a BRIDGE request without it and the relay
// refuses the bridge's connection, so show the upgrade prompt rather than a
// form that would just fail.
function BridgeTokensCard({ orgId }: { readonly orgId: string }) {
  const entitled = useDataFeedEntitled();
  const { data: tokens = [], isLoading: loading, error: loadError, mutate: loadTokens } = useSWR(
    entitled ? [orgId, "tokens", "BRIDGE"] : null,
    () => fetchTokensByType(orgId, "BRIDGE"),
  );
  const [label, setLabel] = useState("");
  const [pinnedMatchId, setPinnedMatchId] = useState("");
  const [matches, setMatches] = useState<MatchOption[]>([]);
  const [generating, setGenerating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!entitled) return;
    fetch(`/api/orgs/${orgId}/matches?status=LIVE,SCHEDULED`)
      .then(res => res.ok ? res.json() : { matches: [] })
      .then(data => setMatches(data.matches || []))
      .catch(() => setMatches([]));
  }, [orgId, entitled]);

  const generateToken = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`/api/orgs/${orgId}/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined, matchId: pinnedMatchId || undefined }),
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
    if (!confirm("Revoke this bridge token? Any venue laptop using it will lose connection until reconfigured with a new one.")) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/tokens/${tokenId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await loadTokens();
    } catch {
      setError("Failed to revoke token");
    }
  };

  if (entitled === null) return null;

  if (!entitled) {
    return (
      <Card title="Bridge Devices">
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Score from a physical Saturn/Vega scoreboard console at the venue — requires the Data Feed add-on.
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
          An Admin can add it under <a href="/account" style={{ color: "var(--accent)" }}>Account → Billing</a>.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Bridge Devices">
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Generate a token for each venue laptop running the bridge app. Paste it into the bridge&apos;s
        <strong>Bridge Secret</strong> field, then choose the match in the bridge app. Pin
        the token to a match here only if that laptop should never feed any other match.
      </p>

      <div className="flex items-center gap-3 mb-4 p-3 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="flex-1">
          <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>ScoreHub Bridge app</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
            Install on the venue laptop, then paste a token below into its setup screen.
          </p>
        </div>
        <a
          href="https://downloads.scorehub.co.nz/mac"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg px-3 py-2 text-xs font-bold shrink-0"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)", textDecoration: "none" }}
        >
          Mac
        </a>
        <a
          href="https://downloads.scorehub.co.nz/windows"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg px-3 py-2 text-xs font-bold shrink-0"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)", textDecoration: "none" }}
        >
          Windows
        </a>
      </div>

      {justCreated && (
        <div className="mb-3 p-3 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-accent)" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--accent)" }}>
            Copy this now — it won&apos;t be shown again:
          </p>
          <div className="flex gap-2">
            <code className="text-xs flex-1 p-2 rounded overflow-x-auto" style={{ background: "var(--bg-base)", color: "var(--accent)" }}>
              {justCreated}
            </code>
            <button
              className="rounded-lg px-3 text-xs font-semibold shrink-0"
              style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
              onClick={() => navigator.clipboard.writeText(justCreated)}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Label (e.g. Venue laptop 1)"
          className="flex-1 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <select
          className="rounded-lg px-3 py-2 text-sm shrink-0"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          value={pinnedMatchId}
          onChange={e => setPinnedMatchId(e.target.value)}
        >
          <option value="">All matches</option>
          {matches.map(m => (
            <option key={m.id} value={m.id}>
              {(m.homeName || "Home")} v {(m.visitorName || "Visitor")} ({m.status === "LIVE" ? "live" : "scheduled"})
            </option>
          ))}
        </select>
        <button
          className="rounded-lg px-3 py-2 text-sm font-semibold shrink-0"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
          onClick={generateToken}
          disabled={generating}
        >
          {generating ? "Generating…" : "Generate Token"}
        </button>
      </div>

      {(error || loadError) && <p className="text-xs mb-3" style={{ color: "#EF4444" }}>{error || "Failed to load bridge tokens"}</p>}

      {(() => {
        if (loading) return <p className="text-xs" style={{ color: "var(--text-dim)" }}>Loading…</p>;
        if (tokens.length === 0) return <p className="text-xs" style={{ color: "var(--text-dim)" }}>No bridge tokens yet.</p>;
        return (
        <div className="space-y-1.5">
          {tokens.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded" style={{ background: "var(--bg-elevated)" }}>
              <div>
                <div style={{ color: "var(--text-primary)" }}>{t.label || "Unlabeled"}</div>
                <div style={{ color: "var(--text-dim)" }}>{new Date(t.createdAt).toLocaleDateString()}</div>
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
    </Card>
  );
}

// Third-party integrations (Singular.live, VIZRT) authenticate with a
// long-lived DATA_FEED token against GET /api/data-feed/state and the
// "data-feed" socket role — see relay/src/auth.ts's verifyDataFeedSecret.
// Gated behind the data-feed add-on, like BridgeTokensCard above and unlike
// WebhookCard (Stream Deck tokens are ungated by design) — POST /api/orgs/
// [orgId]/tokens 403s a DATA_FEED request for an org without the add-on, so
// this card checks the same entitlement client-side to show an upgrade
// prompt instead of a form that would just fail.
function DataFeedTokensCard({ orgId }: { readonly orgId: string }) {
  const entitled = useDataFeedEntitled();
  const [label, setLabel] = useState("");
  const [generating, setGenerating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [error, setError] = useState("");

  const { data: tokens = [], isLoading: loading, error: loadError, mutate: loadTokens } = useSWR(
    entitled ? [orgId, "tokens", "DATA_FEED"] : null,
    () => fetchTokensByType(orgId, "DATA_FEED"),
  );

  const generateToken = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`/api/orgs/${orgId}/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined, type: "DATA_FEED" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { token } = await res.json();
      setJustCreated(token);
      setLabel("");
      await loadTokens();
    } catch {
      setError("Failed to generate token");
    } finally {
      setGenerating(false);
    }
  };

  const revokeToken = async (tokenId: string) => {
    if (!confirm("Revoke this data feed token? Any third-party integration using it will lose access until reconfigured with a new one.")) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/tokens/${tokenId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await loadTokens();
    } catch {
      setError("Failed to revoke token");
    }
  };

  if (entitled === false) {
    return (
      <Card title="Data Feed">
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Pipe live match state into a third-party graphics engine (Singular.live, Chyron, VIZRT) —
          requires the Data Feed add-on.
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
          Upgrade at <code>/account/billing</code>.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Data Feed">
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Generate a token for a third-party graphics engine (Singular.live, Chyron, VIZRT) to connect
        to <code>{`${RELAY_URL}/api/data-feed/state`}</code> — send it as the <code>x-data-feed-secret</code> header.
      </p>

      {justCreated && (
        <div className="mb-3 p-3 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-accent)" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--accent)" }}>
            Copy this now — it won&apos;t be shown again:
          </p>
          <div className="flex gap-2">
            <code className="text-xs flex-1 p-2 rounded overflow-x-auto" style={{ background: "var(--bg-base)", color: "var(--accent)" }}>
              {justCreated}
            </code>
            <button
              className="rounded-lg px-3 text-xs font-semibold shrink-0"
              style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
              onClick={() => navigator.clipboard.writeText(justCreated)}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Label (e.g. Singular.live)"
          className="flex-1 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <button
          className="rounded-lg px-3 py-2 text-sm font-semibold shrink-0"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
          onClick={generateToken}
          disabled={generating}
        >
          {generating ? "Generating…" : "Generate Token"}
        </button>
      </div>

      {(error || loadError) && <p className="text-xs mb-3" style={{ color: "#EF4444" }}>{error || "Failed to load data feed tokens"}</p>}

      {(() => {
        if (loading) return <p className="text-xs" style={{ color: "var(--text-dim)" }}>Loading…</p>;
        if (tokens.length === 0) return <p className="text-xs" style={{ color: "var(--text-dim)" }}>No data feed tokens yet.</p>;
        return (
        <div className="space-y-1.5">
          {tokens.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded" style={{ background: "var(--bg-elevated)" }}>
              <div>
                <div style={{ color: "var(--text-primary)" }}>{t.label || "Unlabeled"}</div>
                <div style={{ color: "var(--text-dim)" }}>{new Date(t.createdAt).toLocaleDateString()}</div>
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
    </Card>
  );
}

export function SettingsTab({ state, push, matchId, onEnded }: {
  readonly state: MatchState;
  readonly push: (p: Partial<MatchState>) => void | Promise<void>;
  readonly matchId?: string;
  readonly onEnded?: () => void;
}) {
  const template = getTemplate(state.sport);
  const { data: session } = useSession();
  const orgId = session?.user?.activeOrgId;
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState("");

  async function handleEndMatch() {
    if (!orgId || !matchId) return;
    if (!globalThis.confirm("End this match? It will move to History and can't be scored unless you reopen it.")) return;
    setEnding(true);
    setEndError("");
    // An ended match is read-only on the relay, so nothing could stop a
    // clock that was left running once this goes through.
    if (state.isRunning) await push({ isRunning: false });
    try {
      const res = await fetch(`/api/orgs/${orgId}/matches/${matchId}/end`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setEndError(body?.error ?? "Couldn't end the match — try again.");
        setEnding(false);
        return;
      }
      onEnded?.();
    } catch {
      setEndError("Couldn't reach the server — try again.");
      setEnding(false);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {/* Team colours */}
      <Card title="Home — Team Colour">
        <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
          Used for score text, colour strips, logos, and possession indicators across all displays.
        </p>
        <ColorSwatch color={state.home.color || "#F59E0B"} />
        <input
          type="color"
          className="mt-3 rounded-lg w-full h-10 cursor-pointer"
          style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
          value={state.home.color || "#F59E0B"}
          onChange={e => push({ home: { ...state.home, color: e.target.value } })}
        />
        <div className="flex gap-2 mt-2 flex-wrap">
          {["#F59E0B", "#EF4444", "#22C55E", "#3B82F6", "#EC4899", "#FFFFFF"].map(c => (
            <button key={c} style={{ width: 28, height: 28, borderRadius: 6, background: c, border: state.home.color === c ? "2px solid white" : "2px solid transparent" }}
              onClick={() => push({ home: { ...state.home, color: c } })} />
          ))}
        </div>
      </Card>

      <Card title="Visitor — Team Colour">
        <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
          Used for score text, colour strips, logos, and possession indicators across all displays.
        </p>
        <ColorSwatch color={state.visitor.color || "#818CF8"} />
        <input
          type="color"
          className="mt-3 rounded-lg w-full h-10 cursor-pointer"
          style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
          value={state.visitor.color || "#818CF8"}
          onChange={e => push({ visitor: { ...state.visitor, color: e.target.value } })}
        />
        <div className="flex gap-2 mt-2 flex-wrap">
          {["#818CF8", "#8B5CF6", "#06B6D4", "#F97316", "#14B8A6", "#E2E8F0"].map(c => (
            <button key={c} style={{ width: 28, height: 28, borderRadius: 6, background: c, border: state.visitor.color === c ? "2px solid white" : "2px solid transparent" }}
              onClick={() => push({ visitor: { ...state.visitor, color: c } })} />
          ))}
        </div>
      </Card>

      {/* Sport selector */}
      <Card title="Sport">
        <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>Select sport to update display labels and preview match defaults.</p>
        <div className="grid grid-cols-2 gap-2">
          {SPORT_TEMPLATES.map(t => (
            <button key={t.sport}
              className="rounded-lg px-3 py-2 text-left"
              style={{
                background: state.sport === t.sport ? "var(--accent-dim)" : "var(--bg-elevated)",
                border: `1px solid ${state.sport === t.sport ? "var(--border-accent)" : "var(--border)"}`,
                color: state.sport === t.sport ? "var(--accent)" : "var(--text-secondary)",
              }}
              onClick={() => push({ sport: t.sport })}
            >
              <div className="text-sm font-semibold">{t.label}</div>
              <div className="text-xs mt-0.5" style={{ color: state.sport === t.sport ? "var(--accent)" : "var(--text-dim)", opacity: 0.85 }}>{t.structure}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Template defaults preview */}
      <Card title={`Template Defaults — ${template.label}`}>
        <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
          Applies match structure without resetting scores, team names, or colours.
        </p>
        <div className="space-y-1.5 mb-4">
          <TemplateRow label="Structure" value={getStructureLabel(state)} />
          <TemplateRow label="Clock" value={templateClockLabel(template.clockSeconds, template.countDown)} />
          <TemplateRow label="Timeouts" value={template.timeoutsPerTeam === 0 ? "None" : `${template.timeoutsPerTeam} per team`} />
          <TemplateRow label="Possession" value={template.defaultPossession === "none" ? "Off" : "On"} />
        </div>
        <button
          className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
          onClick={() => push({
            sport: template.sport,
            clockSeconds: template.clockSeconds,
            countDown: template.countDown,
            period: "1",
            isRunning: false,
            possession: template.defaultPossession,
            home: { ...state.home, timeouts: template.timeoutsPerTeam, faults: 0 },
            visitor: { ...state.visitor, timeouts: template.timeoutsPerTeam, faults: 0 },
          })}
        >
          Apply Template Defaults
        </button>
      </Card>

      {/* End match */}
      {matchId && (
        <Card title="End Match">
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            Moves this match to History and locks its score. To correct it later, reopen it from History.
          </p>
          {endError && (
            <p className="text-xs mb-3 font-semibold" style={{ color: "var(--danger)" }}>{endError}</p>
          )}
          <button
            data-testid="end-match"
            className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--danger)" }}
            disabled={ending}
            onClick={handleEndMatch}
          >
            {ending ? "Ending…" : "End Match"}
          </button>
        </Card>
      )}

      {/* Connection info */}
      <Card title="Connection">
        <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
          Your relay URL. The Bridge app and Stream Deck plugin already use ScoreHub&apos;s by default — you only
          need this for the webhook endpoints, or if support asks you to set it under <strong>Advanced</strong>.
        </p>
        <div className="flex gap-2">
          <code data-testid="relay-url" className="text-xs flex-1 p-2 rounded overflow-x-auto" style={{ background: "var(--bg-elevated)", color: "var(--accent)" }}>
            {RELAY_URL}
          </code>
          <button
            className="rounded-lg px-3 text-xs font-semibold shrink-0"
            style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
            onClick={() => navigator.clipboard.writeText(RELAY_URL)}
          >
            Copy
          </button>
        </div>
      </Card>

      {(session?.user?.activeRole === "ADMIN" || session?.user?.activeRole === "MANAGER") && orgId && (
        <>
          <WebhookCard orgId={orgId} matchId={matchId} />
          <BridgeTokensCard orgId={orgId} />
          <DataFeedTokensCard orgId={orgId} />
        </>
      )}
    </div>
  );
}
