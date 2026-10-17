import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { SectionLabel } from "./primitives";

const DISPLAYS = [
  {
    href: "/display/fullscreen",
    label: "Fullscreen",
    desc: "Second screen / projector / capture card. Press F to go fullscreen. Layouts: Wide, Stacked, Minimal.",
    tags: ["HDMI", "Capture Card", "Projector"],
    windowSize: "1920,1080",
  },
  {
    href: "/display/basic",
    label: "Basic",
    desc: "Clean scoreboard panel. Good for venue screens and preview monitors.",
    tags: ["Venue Screen", "Preview"],
    windowSize: "1200,400",
  },
  {
    href: "/display/advanced",
    label: "Advanced",
    desc: "Full display with team logos, timeout pips, and on-court player roster.",
    tags: ["Full Stats", "Broadcast Monitor"],
    windowSize: "1400,600",
  },
  {
    href: "/display/overlay",
    label: "Lower-Third Overlay",
    desc: "Transparent background. Add as Browser Source (1920×120) in OBS/vMix/Wirecast.",
    tags: ["OBS", "vMix", "Wirecast", "Transparent"],
    windowSize: "1920,120",
  },
  {
    href: "/display/scorebug",
    label: "Scorebug",
    desc: "Compact corner widget with transparent background. URL params: ?position=tr|tl|br|bl&size=sm|md|lg",
    tags: ["OBS", "vMix", "Corner Widget", "Transparent"],
    windowSize: "480,100",
  },
];

export function OutputsTab({ matchId }: { readonly matchId?: string }) {
  const { data: session } = useSession();
  const orgId = session?.user?.activeOrgId;
  const origin = typeof globalThis.window !== "undefined" ? globalThis.window.location.origin : "";

  // Required alongside matchId once DISPLAY_TOKEN_REQUIRED is on
  // (relay/src/server.ts) — fetched here rather than threaded down as a prop
  // since this is the only tab that needs it.
  const [fetchedDisplayToken, setDisplayToken] = useState<string | null>(null);
  const displayToken = orgId && matchId ? fetchedDisplayToken : null;
  useEffect(() => {
    if (!orgId || !matchId) return;
    fetch(`/api/orgs/${orgId}/matches?id=${matchId}`)
      .then(res => res.json())
      .then(data => setDisplayToken(data?.matches?.[0]?.displayToken ?? null))
      .catch(err => {
        console.warn("[OutputsTab] failed to fetch display token:", err);
        setDisplayToken(null);
      });
  }, [orgId, matchId]);

  // Mirrors the rotate-display-token route's own role check — Operators
  // can't rotate the link, so they don't get the button (SA-117).
  const canRotate = session?.user?.activeRole === "ADMIN" || session?.user?.activeRole === "MANAGER";
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const rotateDisplayToken = async () => {
    if (!orgId || !matchId) return;
    if (!confirm("Regenerate the display link? Every link/OBS scene currently using the old one will stop working.")) return;
    setRotating(true);
    setRotateError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/matches/${matchId}/rotate-display-token`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDisplayToken(data.displayToken);
      } else {
        setRotateError("Couldn't regenerate the display link — the existing link still works. Try again.");
      }
    } catch {
      setRotateError("Couldn't regenerate the display link — the existing link still works. Try again.");
    } finally {
      setRotating(false);
    }
  };

  // Display pages scope themselves to a tenant via ?org= (see useMatchState) —
  // without it the relay falls back to the legacy single-tenant room, which
  // no longer exists post-multi-tenant migration and yields no data (SA-65).
  // ?matchId= further scopes to this specific match — without it a display
  // falls back to the org's singleton "default" match, which is wrong (or
  // empty) once an org has more than one match going. ?token= is the
  // per-match displayToken (see DISPLAY_TOKEN_REQUIRED) — always included
  // once known so freshly copied/opened links keep working after enforcement
  // flips on.
  //
  // The link is only ever handed over through Copy URL / Pop Out, never
  // printed: it's for a ScoreHub display, and the relay won't serve its feed
  // to anything else (DISPLAY_ORIGIN_REQUIRED, SA-159).
  const withOrg = (path: string) => {
    const params = new URLSearchParams();
    if (orgId) params.set("org", orgId);
    if (matchId) params.set("matchId", matchId);
    if (displayToken) params.set("token", displayToken);
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  return (
    <div className="space-y-6">
      {matchId && canRotate && (
        <div className="flex items-center justify-end gap-3">
          {rotateError && (
            <p role="alert" className="text-xs font-semibold" style={{ color: "var(--danger)" }}>{rotateError}</p>
          )}
          <button
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            onClick={rotateDisplayToken}
            disabled={rotating}
          >
            {rotating ? "Regenerating…" : "Regenerate display link"}
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4">
        {DISPLAYS.map(d => {
          const href = withOrg(d.href);
          return (
          <div key={d.href} className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-bold text-base" style={{ color: "var(--text-primary)" }}>{d.label}</span>
                  {d.tags.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded font-semibold tracking-wide"
                      style={{ background: "var(--bg-elevated)", color: "var(--text-dim)" }}>
                      {t}
                    </span>
                  ))}
                </div>
                <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{d.desc}</p>
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                <button
                  className="rounded-lg px-4 py-2 text-xs font-bold tracking-wide whitespace-nowrap"
                  style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
                  onClick={() => window.open(href, `scoreboard-${d.label}`, `width=${d.windowSize.split(",")[0]},height=${d.windowSize.split(",")[1]},menubar=no,toolbar=no,location=no,status=no`)}
                >
                  ↗ Pop Out
                </button>
                <button
                  className="rounded-lg px-4 py-2 text-xs font-bold tracking-wide whitespace-nowrap"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                  onClick={() => navigator.clipboard.writeText(`${origin}${href}`)}
                >
                  Copy URL
                </button>
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {/* Graphics Operator add-on section */}
      <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <SectionLabel>Graphics Control — Add-on</SectionLabel>
        <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
          Broadcast-style lower thirds, player stat cards, and headshot bios, driven from a second device and pushed
          live to your display outputs.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <GraphicsLinkCard
            href={matchId ? `/control/graphics?matchId=${matchId}` : "/control/graphics"}
            label="Graphics Control"
            desc="Switch scenes live during a match."
          />
          <GraphicsLinkCard
            href={matchId ? `/control/roster?matchId=${matchId}` : "/control/roster"}
            label="Player Roster"
            desc="Manage headshots and bios ahead of time."
          />
        </div>
      </div>

      {/* Graphics software section — the feed itself is part of the Data
          Feed add-on (token-authenticated, see DataFeedTokensCard on the
          Settings tab), so this only points there. Display links are for
          ScoreHub's own displays, not a data source for other software. */}
      <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <SectionLabel>Graphics Software — Data Feed Add-on</SectionLabel>
        <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
          For software that drives its own graphics templates (Singular.live, Chyron, Ross Xpression, VIZRT), the Data
          Feed add-on gives you a token-authenticated feed of this match&apos;s live state.
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
          An Admin or Manager generates a token on the <strong>Settings</strong> tab under <strong>Data Feed</strong>.
          An Admin can add the add-on under <a href="/account" style={{ color: "var(--accent)" }}>Account → Add-ons</a>.
        </p>
      </div>
    </div>
  );
}

function GraphicsLinkCard({ href, label, desc }: { readonly href: string; readonly label: string; readonly desc: string }) {
  return (
    <a
      href={href}
      className="rounded-lg p-3 flex items-center justify-between gap-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", textDecoration: "none" }}
    >
      <div>
        <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>{desc}</p>
      </div>
      <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>Open ↗</span>
    </a>
  );
}
