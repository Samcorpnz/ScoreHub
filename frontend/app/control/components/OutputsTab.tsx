import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { RELAY_URL } from "../lib/relay";
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

  const [rotating, setRotating] = useState(false);
  const rotateDisplayToken = async () => {
    if (!orgId || !matchId) return;
    if (!confirm("Regenerate the display link? Every link/OBS scene currently using the old one will stop working.")) return;
    setRotating(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/matches/${matchId}/rotate-display-token`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDisplayToken(data.displayToken);
      }
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
      {matchId && (
        <div className="flex justify-end">
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
                <p className="text-xs mt-2 font-mono" style={{ color: "var(--text-dim)" }}>{origin}{href}</p>
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

      {/* Graphics software section */}
      <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <SectionLabel>Graphics Software — Data Feed</SectionLabel>
        <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
          For software that drives its own graphics templates (Singular.live, Chyron, Ross Xpression, VIZRT), connect to the live data feed:
        </p>
        <div className="mt-4 space-y-3">
          <DataFeedRow label="REST snapshot" value={`${RELAY_URL}${withOrg("/state")}`} desc="GET — JSON snapshot of current state, poll at 1–5 Hz" />
          <DataFeedRow label="WebSocket (Socket.io)" value={`${RELAY_URL}`} desc={`Connect with socket.io-client, listen to "matchStateChange" event`} />
          <DataFeedRow
            label="Event name"
            value="matchStateChange"
            desc="Fired on every state change — score, clock, period, possession, logos"
          />
        </div>
        <div className="mt-4 rounded-lg p-3 text-xs font-mono overflow-x-auto"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", whiteSpace: "pre" }}>
{`// Example: connect from any JS graphics template
const socket = io("${RELAY_URL}", { auth: { orgId: "${orgId ?? "<your-org-id>"}"${matchId ? `, matchId: "${matchId}"` : ""}${displayToken ? `, token: "${displayToken}"` : ""} } });
socket.on("matchStateChange", (state) => {
  // state.home.name, state.home.score, state.home.color, state.home.logoUrl
  // state.visitor.name, state.visitor.score
  // state.clockSeconds, state.period, state.isRunning
  updateGraphics(state);
});`}
        </div>
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

function DataFeedRow({ label, value, desc }: { readonly label: string; readonly value: string; readonly desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs font-bold tracking-wide pt-0.5 flex-shrink-0" style={{ color: "var(--text-dim)", minWidth: 180 }}>{label}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono flex-1 min-w-0 truncate" style={{ color: "var(--accent)" }}>{value}</code>
          <button
            className="text-xs rounded px-2 py-0.5 flex-shrink-0"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-dim)" }}
            onClick={() => navigator.clipboard.writeText(value)}
          >
            Copy
          </button>
        </div>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>{desc}</p>
      </div>
    </div>
  );
}
