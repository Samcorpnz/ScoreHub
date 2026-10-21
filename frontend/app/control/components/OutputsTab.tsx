import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { SectionLabel } from "./primitives";
import { MatchState } from "../../types";
import { useHasAddOn } from "../../hooks/useAddOns";
import { ChromaKey } from "../../hooks/useChromaKey";
import { OutputStylesCard } from "./OutputStylesCard";
import { GraphicsDataCard } from "./GraphicsDataCard";

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
    keyable: true,
  },
  {
    href: "/display/scorebug",
    label: "Scorebug",
    desc: "Compact corner widget with transparent background. URL params: ?position=tr|tl|br|bl&size=sm|md|lg",
    tags: ["OBS", "vMix", "Corner Widget", "Transparent"],
    windowSize: "480,100",
    keyable: true,
  },
];

// Graphics add-on: solid key colours for outputs that are otherwise
// transparent, for switchers (an ATEM over HDMI/SDI) that can't take alpha
const KEY_OPTIONS: { key: ChromaKey; label: string }[] = [
  { key: "green", label: "Green key" },
  { key: "blue", label: "Blue key" },
];

export function OutputsTab({ matchId, state, push, controlToken }: {
  readonly matchId?: string;
  readonly state: MatchState;
  readonly push: (p: Partial<MatchState>) => void;
  readonly controlToken: string;
}) {
  const { data: session } = useSession();
  const hasGraphics = useHasAddOn("graphics-operator");
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
  const withOrg = (path: string, key?: ChromaKey) => {
    const params = new URLSearchParams();
    if (orgId) params.set("org", orgId);
    if (matchId) params.set("matchId", matchId);
    if (displayToken) params.set("token", displayToken);
    if (key) params.set("key", key);
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
            {d.keyable && hasGraphics && (
              <KeyLinks onCopy={key => navigator.clipboard.writeText(`${origin}${withOrg(d.href, key)}`)} testIdPrefix={d.label} />
            )}
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
        {hasGraphics && (
          <div className="mt-4">
            <p className="text-xs mb-2" style={{ color: "var(--text-dim)" }}>
              Graphics output on a solid key colour, for switchers that can&apos;t take a transparent source:
            </p>
            <KeyLinks onCopy={key => navigator.clipboard.writeText(`${origin}${withOrg("/display/graphics", key)}`)} testIdPrefix="Graphics" />
          </div>
        )}
        {hasGraphics === false && (
          <p className="text-xs mt-4" style={{ color: "var(--text-dim)" }}>
            The Graphics add-on also unlocks per-output fonts, sizes and backgrounds, green and blue key outputs, and a
            data out link for vMix and OBS. An Admin can add it under{" "}
            <a href="/account" style={{ color: "var(--accent)" }}>Account → Add-ons</a>.
          </p>
        )}
        {/* Styles set while the account had the add-on still show on the
            displays, and the editor above is gone — so offer a way out. The
            relay accepts clearing them without the add-on. */}
        {hasGraphics === false && Object.keys(state.displayTheme?.outputs ?? {}).length > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 p-3 rounded-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              This match still has per-output styles from the Graphics add-on, and the displays still use them.
            </p>
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-semibold shrink-0"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              data-testid="output-styles-clear"
              onClick={() => push({ displayTheme: { ...state.displayTheme, outputs: {} } })}
            >
              Clear per-output styles
            </button>
          </div>
        )}
      </div>

      {hasGraphics && <OutputStylesCard state={state} push={push} controlToken={controlToken} />}
      {hasGraphics && orgId && <GraphicsDataCard orgId={orgId} matchId={matchId} canManage={canRotate} />}

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

function KeyLinks({ onCopy, testIdPrefix }: { readonly onCopy: (key: ChromaKey) => void; readonly testIdPrefix: string }) {
  return (
    <div className="flex gap-2 flex-wrap mt-3">
      {KEY_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          data-testid={`key-link-${testIdPrefix}-${key}`}
          className="rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          onClick={() => onCopy(key)}
        >
          <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, background: key === "green" ? "#00B140" : "#0047BB" }} />
          Copy {label} URL
        </button>
      ))}
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
