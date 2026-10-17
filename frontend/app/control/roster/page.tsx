"use client";

import { useRef, useState, Suspense } from "react";
import useSWR from "swr";
import * as Sentry from "@sentry/nextjs";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMatchState } from "../../hooks/useMatchState";
import { useControlToken } from "../../hooks/useControlToken";
import { useGraphicsToken } from "../../hooks/useGraphicsToken";
import { RELAY_URL } from "../lib/relay";

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  externalId: string | null;
  provider: string | null;
  photoUrl: string | null;
  bio: string | null;
}

// Distinguishes the org-lacks-add-on 403 from a real fetch failure so the
// upsell screen and the inline error banner don't both fire for one cause.
class RosterForbiddenError extends Error {}

async function fetchPlayers(orgId: string): Promise<Player[]> {
  const res = await fetch(`/api/orgs/${orgId}/players`);
  if (res.status === 403) throw new RosterForbiddenError("forbidden");
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.players ?? [];
}

// Roster admin for the Graphics Operator add-on (Phase C) — a standalone
// route (like control/graphics), not a tab on the scoring control panel,
// since roster upkeep happens well before/after a live match, not during it.
export default function RosterControlPage() {
  return (
    <Suspense>
      <RosterControl />
    </Suspense>
  );
}

function RosterControl() {
  const router = useRouter();
  useSession({
    required: true,
    onUnauthenticated() {
      router.push("/login?callbackUrl=/control/roster");
    },
  });

  const { data: session } = useSession();
  const orgId = session?.user?.activeOrgId;
  // Photo uploads are a stateless REST call authorized by org alone (see
  // /api/player-photo/:playerId) — no matchId scoping needed for that.
  const controlToken = useControlToken();
  // Without ?matchId=, this scopes to the org's singleton "default" room
  // instead of whichever match is actually live — same reasoning as
  // control/graphics/page.tsx. Uses a graphics-role token (not controlToken
  // above) so this read-only socket doesn't enter the scoring controller
  // mutex alongside whoever's actually scoring the match.
  const matchId = useSearchParams().get("matchId") ?? undefined;
  const { token: graphicsToken } = useGraphicsToken(matchId);
  const { state } = useMatchState({ secret: graphicsToken, role: "graphics" });

  const { data: players = [], isLoading: loading, error: loadError, mutate: loadPlayers } = useSWR(
    orgId ? [orgId, "players"] : null,
    () => fetchPlayers(orgId as string),
    {
      onError: err => {
        if (err instanceof RosterForbiddenError) return;
        console.error("[roster] failed to load roster:", err);
        Sentry.captureException(err, { tags: { area: "roster" } });
      },
    },
  );
  const forbidden = loadError instanceof RosterForbiddenError;
  const [actionError, setActionError] = useState("");
  const error = actionError || (loadError && !forbidden ? "Failed to load roster" : "");
  const [editing, setEditing] = useState<Player | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [prefill, setPrefill] = useState<{ name?: string; externalId?: string } | null>(null);

  if (forbidden) {
    return <RosterUpsell isAdmin={session?.user?.activeRole === "ADMIN"} />;
  }

  const deletePlayer = async (playerId: string) => {
    if (!orgId) return;
    if (!confirm("Remove this player from the roster? Their photo is deleted too.")) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/players/${playerId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? "Failed to remove player");
        return;
      }
      await loadPlayers();
    } catch {
      setActionError("Failed to remove player");
    }
  };

  // Live feed players with no roster match (by provider+externalId) — per
  // product decision, linking is manual only, no fuzzy name-matching.
  const feedPlayers = state.graphicsFeed?.stats.players ?? [];
  const unmatchedFeedPlayers = feedPlayers.filter(
    fp => !players.some(p => p.externalId === fp.id && p.provider === state.graphicsFeed?.provider)
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 800 }}>Player Roster</h1>
        <button
          data-testid="add-player-button"
          onClick={() => { setEditing(null); setPrefill(null); setShowForm(true); }}
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)", borderRadius: 8, padding: "8px 14px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
        >
          + Add Player
        </button>
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: "0.8rem", marginBottom: 12 }}>{error}</p>}

      {unmatchedFeedPlayers.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <SectionLabel>Live match — unmatched players</SectionLabel>
          <p style={{ fontSize: "0.7rem", color: "var(--text-dim)", margin: "6px 0 10px" }}>
            These players appear in the live feed but aren&apos;t linked to a roster entry yet.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {unmatchedFeedPlayers.map(fp => (
              <UnmatchedCard
                key={fp.id}
                name={fp.name}
                team={fp.team}
                players={players}
                onLinkExisting={async (playerId) => {
                  if (!orgId) return;
                  await fetch(`/api/orgs/${orgId}/players/${playerId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ externalId: fp.id, provider: state.graphicsFeed?.provider }),
                  });
                  await loadPlayers();
                }}
                onCreateNew={() => {
                  setEditing(null);
                  setPrefill({ name: fp.name, externalId: fp.id });
                  setShowForm(true);
                }}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionLabel>Roster ({players.length})</SectionLabel>
        {(() => {
          if (loading) return <p style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 8 }}>Loading…</p>;
          if (players.length === 0) return <p style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 8 }}>No players yet — add one above.</p>;
          return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, marginTop: 10 }}>
            {players.map(p => (
              <PlayerCard
                key={p.id}
                player={p}
                orgId={orgId}
                controlToken={controlToken}
                onEdit={() => { setEditing(p); setPrefill(null); setShowForm(true); }}
                onDelete={() => deletePlayer(p.id)}
                onPhotoUploaded={loadPlayers}
              />
            ))}
          </div>
          );
        })()}
      </section>

      {showForm && orgId && (
        <PlayerFormModal
          orgId={orgId}
          existing={editing}
          prefill={prefill}
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await loadPlayers(); }}
        />
      )}
    </div>
  );
}

function RosterUpsell({ isAdmin }: { readonly isAdmin: boolean }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)", padding: 24, display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 480, marginTop: "10vh", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: 8 }}>Unlock Player Photos & Bios</h1>
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 20 }}>
          Manage a roster of player headshots and bios that feed straight into your Graphics scenes — no more
          generic name-only lower thirds.
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", textAlign: "left", fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 8 }}>
          <li>✓ Upload headshots once, reuse across every match</li>
          <li>✓ Auto-links to live feed players by provider ID</li>
          <li>✓ Powers the Headshot + Bio scene in Graphics Control</li>
        </ul>
        {isAdmin ? (
          <a
            href="/account"
            style={{ display: "inline-block", background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)", borderRadius: 8, padding: "10px 20px", fontSize: "0.85rem", fontWeight: 700, textDecoration: "none" }}
          >
            Add Graphics — $29/mo
          </a>
        ) : (
          <p style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
            Ask your account admin to add Graphics Operator ($29/mo) from Account settings.
          </p>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { readonly children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-dim)" }}>
      {children}
    </span>
  );
}

function UnmatchedCard({ name, team, players, onLinkExisting, onCreateNew }: {
  readonly name: string;
  readonly team: string;
  readonly players: Player[];
  readonly onLinkExisting: (playerId: string) => void;
  readonly onCreateNew: () => void;
}) {
  const [selected, setSelected] = useState("");
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>{name}</div>
        <div style={{ fontSize: "0.6rem", color: "var(--text-dim)", textTransform: "uppercase" }}>{team}</div>
      </div>
      <select
        value={selected}
        onChange={e => setSelected(e.target.value)}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "4px 6px", fontSize: "0.75rem" }}
      >
        <option value="">Link to existing player…</option>
        {players.map(p => (
          <option key={p.id} value={p.id}>{p.displayName || `${p.firstName} ${p.lastName}`}</option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          disabled={!selected}
          onClick={() => selected && onLinkExisting(selected)}
          style={{ flex: 1, background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)", borderRadius: 6, padding: "6px 8px", fontSize: "0.7rem", fontWeight: 700, cursor: selected ? "pointer" : "not-allowed", opacity: selected ? 1 : 0.5 }}
        >
          Link
        </button>
        <button
          onClick={onCreateNew}
          style={{ flex: 1, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", borderRadius: 6, padding: "6px 8px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}
        >
          New player
        </button>
      </div>
    </div>
  );
}

function PlayerCard({ player, orgId, controlToken, onEdit, onDelete, onPhotoUploaded }: {
  readonly player: Player;
  readonly orgId?: string | null;
  readonly controlToken: string;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onPhotoUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!orgId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch(`${RELAY_URL}/api/player-photo/${player.id}`, {
        method: "POST",
        headers: { "x-control-secret": controlToken },
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const { photoUrl } = await res.json();
      await fetch(`/api/orgs/${orgId}/players/${player.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl }),
      });
      onPhotoUploaded();
    } finally {
      setUploading(false);
    }
  };

  // The players route deletes the stored file as well as clearing photoUrl.
  const removePhoto = async () => {
    if (!orgId) return;
    if (!confirm("Remove this player's photo? The image is deleted.")) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/players/${player.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl: null }),
      });
      if (!res.ok) throw new Error(await res.text());
      onPhotoUploaded();
    } catch {
      alert("Couldn't remove the photo. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div data-testid={`player-card-${player.id}`} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, display: "flex", gap: 10 }}>
      <button
        type="button"
        data-testid={`player-photo-preview-${player.id}`}
        onClick={() => inputRef.current?.click()}
        style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--bg-elevated)", flexShrink: 0, cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", padding: 0 }}
      >
        {player.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={player.photoUrl.startsWith("/player-photos/") ? `${RELAY_URL}${player.photoUrl}` : player.photoUrl} alt={player.firstName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>{uploading ? "…" : "+"}</span>
        )}
      </button>
      <input ref={inputRef} data-testid={`player-photo-input-${player.id}`} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>{player.displayName || `${player.firstName} ${player.lastName}`}</div>
        {player.provider && (
          <div style={{ fontSize: "0.6rem", color: "var(--text-dim)" }}>{player.provider} · {player.externalId}</div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button onClick={onEdit} style={{ fontSize: "0.65rem", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Edit</button>
          {player.photoUrl && (
            <button onClick={removePhoto} disabled={uploading} data-testid={`player-photo-remove-${player.id}`} style={{ fontSize: "0.65rem", color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Remove photo</button>
          )}
          <button onClick={onDelete} style={{ fontSize: "0.65rem", color: "var(--danger)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Remove</button>
        </div>
      </div>
    </div>
  );
}

function PlayerFormModal({ orgId, existing, prefill, onClose, onSaved }: {
  readonly orgId: string;
  readonly existing: Player | null;
  readonly prefill: { name?: string; externalId?: string } | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(existing?.firstName ?? prefill?.name?.split(/\s+/)[0] ?? "");
  const [lastName, setLastName] = useState(existing?.lastName ?? prefill?.name?.split(/\s+/).slice(1).join(" ") ?? "");
  const [displayName, setDisplayName] = useState(existing?.displayName ?? "");
  const [externalId, setExternalId] = useState(existing?.externalId ?? prefill?.externalId ?? "");
  const [provider, setProvider] = useState(existing?.provider ?? "");
  const [bio, setBio] = useState(existing?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = { firstName, lastName, displayName: displayName || null, externalId: externalId || null, provider: provider || null, bio: bio || null };
      const res = existing
        ? await fetch(`/api/orgs/${orgId}/players/${existing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/orgs/${orgId}/players`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to save");
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError("Failed to save");
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, width: 360, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: "0.9rem", fontWeight: 800 }}>{existing ? "Edit Player" : "Add Player"}</h2>
        <FormField label="First name"><input data-testid="player-form-first-name" value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} /></FormField>
        <FormField label="Last name"><input data-testid="player-form-last-name" value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} /></FormField>
        <FormField label="Display name (optional)"><input value={displayName} onChange={e => setDisplayName(e.target.value)} style={inputStyle} /></FormField>
        <FormField label="Provider"><input value={provider} onChange={e => setProvider(e.target.value)} placeholder="e.g. championdata" style={inputStyle} /></FormField>
        <FormField label="External ID"><input value={externalId} onChange={e => setExternalId(e.target.value)} style={inputStyle} /></FormField>
        <FormField label="Bio"><textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} /></FormField>
        {error && <p style={{ color: "var(--danger)", fontSize: "0.7rem" }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={onClose} style={{ flex: 1, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", borderRadius: 8, padding: "8px 0", fontSize: "0.8rem", cursor: "pointer" }}>Cancel</button>
          <button data-testid="player-form-save" onClick={save} disabled={saving} style={{ flex: 1, background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)", borderRadius: 8, padding: "8px 0", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.7rem", color: "var(--text-dim)" }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: "0.8rem",
};
