"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useMatchState } from "../hooks/useMatchState";
import { useControlToken } from "../hooks/useControlToken";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { PlanBadge } from "../components/PlanBadge";
import { Card } from "../components/primitives";
import { useBillingPlan } from "../hooks/useBillingPlan";
import { OrgSwitcher } from "../components/OrgSwitcher";
import { MatchState } from "../types";
import { useSoundCues, useSoundPlayback } from "../hooks/useSoundCues";
import { ScoreTab } from "./components/ScoreTab";
import { OutputsTab } from "./components/OutputsTab";
import { LogosTab } from "./components/LogosTab";
import { ThemeTab } from "./components/ThemeTab";
import { AudioTab } from "./components/AudioTab";
import { SettingsTab } from "./components/SettingsTab";

type Tab = "score" | "outputs" | "logos" | "theme" | "audio" | "settings";

export default function ControlPanel() {
  return (
    <Suspense fallback={null}>
      <ControlPanelInner />
    </Suspense>
  );
}

function ControlPanelInner() {
  const router = useRouter();
  const matchId = useSearchParams().get("matchId") ?? undefined;
  const controlToken = useControlToken(matchId);
  const {
    state, status, feedStale, relayUnreachable, sendManualUpdate, sendReset, sendUndo, controllerStatus, takeControl,
    sendCricketBall, sendCricketOverComplete, sendCricketInningsChange, sendCricketDeclare,
    sendScoreAdjust, sendIndoorCricketWicket, estimateServerNow,
  } = useMatchState({ secret: controlToken, role: "control" });
  const { cues, addCue, removeCue } = useSoundCues();
  useSoundPlayback(state, cues);
  // Redirect to login if not authenticated — runs client-side, no Edge Function needed
  const { data: session, status: authStatus } = useSession({
    required: true,
    onUnauthenticated() {
      router.push("/login?callbackUrl=/control");
    },
  });
  const [tab, setTab] = useState<Tab>("score");
  // Logos and theming are Pro features (SA-32) — the relay drops them from a
  // Free-tier org's updates, so show the upgrade prompt rather than controls
  // that would silently do nothing.
  const brandingLocked = useBillingPlan() === "free";

  // Attach a latency-compensated click-instant timestamp whenever a patch
  // toggles isRunning (Start/Stop), so the relay's clock anchor reflects the
  // moment of the click rather than the moment the network round-trip
  // happens to land (see resyncClock/applyManualUpdate on the relay).
  const push = (patch: Partial<MatchState>) =>
    sendManualUpdate("isRunning" in patch ? { ...patch, clientEventMs: estimateServerNow() } : patch);

  // Show nothing while checking auth — prevents flash of content
  if (authStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
        <div className="text-sm" style={{ color: "var(--text-dim)" }}>Loading…</div>
      </div>
    );
  }

  if (session?.user?.activeRole === "VIEWER") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
        <div className="text-sm" style={{ color: "var(--text-dim)" }}>
          Your account doesn&apos;t have control access for this organization.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-4">
          <span className="font-black text-lg tracking-tight">
            Score<span style={{ color: "var(--accent)" }}>Hub</span>
          </span>
          <span className="text-xs px-2 py-1 rounded font-bold tracking-widest uppercase" style={{ background: "var(--bg-elevated)", color: "var(--text-dim)" }}>
            Control
          </span>
        </div>
        <div className="flex items-center gap-4">
          {controllerStatus === "granted" && (
            <span className="text-xs font-bold px-2 py-1 rounded" style={{ background: "rgba(0,200,100,0.15)", color: "#00c864", border: "1px solid rgba(0,200,100,0.3)" }}>
              ● IN CONTROL
            </span>
          )}
          {(controllerStatus === "conflict" || controllerStatus === "revoked" || controllerStatus === "viewer") && (
            <span className="text-xs font-bold px-2 py-1 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-dim)", border: "1px solid var(--border)" }}>
              ○ VIEWING ONLY
            </span>
          )}
          <ConnectionBadge status={status} feedStale={feedStale} relayUnreachable={relayUnreachable} />
          <PlanBadge />
          <OrgSwitcher />
          {session?.user?.name && (
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>
              {session.user.name}
            </span>
          )}
          <a
            href="/account"
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            Account
          </a>
          <a
            href={matchId ? `/control/mobile?matchId=${encodeURIComponent(matchId)}` : "/control/mobile"}
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            Mobile ↗
          </a>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Controller conflict banner */}
      {controllerStatus === "conflict" && (
        <div data-testid="controller-conflict-banner" className="flex items-center justify-between px-6 py-3" style={{ background: "rgba(255,160,0,0.12)", borderBottom: "1px solid rgba(255,160,0,0.3)" }}>
          <span className="text-sm font-bold" style={{ color: "#ffa000" }}>
            Another control panel is already connected to this match.
          </span>
          <button
            data-testid="take-control"
            onClick={takeControl}
            className="rounded-lg px-4 py-1.5 text-xs font-bold"
            style={{ background: "#ffa000", color: "#000" }}
          >
            Take Control
          </button>
        </div>
      )}

      {/* Revoked banner */}
      {controllerStatus === "revoked" && (
        <div data-testid="controller-revoked-banner" className="flex items-center justify-between px-6 py-3" style={{ background: "rgba(255,60,60,0.12)", borderBottom: "1px solid rgba(255,60,60,0.3)" }}>
          <span className="text-sm font-bold" style={{ color: "#ff3c3c" }}>
            Control was taken by another operator. You are now viewing only.
          </span>
          <button
            data-testid="reclaim-control"
            onClick={takeControl}
            className="rounded-lg px-4 py-1.5 text-xs font-bold"
            style={{ background: "#ff3c3c", color: "#fff" }}
          >
            Reclaim Control
          </button>
        </div>
      )}

      {/* Tab nav */}
      <div role="tablist" aria-label="Control panel sections" className="flex px-6 pt-4 gap-1" style={{ borderBottom: "1px solid var(--border)" }}>
        {(["score", "outputs", "logos", "theme", "audio", "settings"] as Tab[]).map(t => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`tabpanel-${t}`}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-bold tracking-wide capitalize rounded-t-lg transition-colors"
            style={{
              background: tab === t ? "var(--bg-surface)" : "transparent",
              color: tab === t ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-6 max-w-5xl" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "score"    && (
          <ScoreTab
            state={state}
            push={push}
            sendReset={sendReset}
            sendUndo={sendUndo}
            sendCricketBall={sendCricketBall}
            sendCricketOverComplete={sendCricketOverComplete}
            sendCricketInningsChange={sendCricketInningsChange}
            sendCricketDeclare={sendCricketDeclare}
            sendScoreAdjust={sendScoreAdjust}
            sendIndoorCricketWicket={sendIndoorCricketWicket}
          />
        )}
        {tab === "outputs"  && <OutputsTab matchId={matchId} />}
        {tab === "logos"    && (brandingLocked
          ? <BrandingUpgradePrompt feature="Team logos" />
          : <LogosTab state={state} push={push} controlToken={controlToken} />)}
        {tab === "theme"    && (brandingLocked
          ? <BrandingUpgradePrompt feature="Display theming" />
          : <ThemeTab state={state} push={push} controlToken={controlToken} />)}
        {tab === "audio"    && <AudioTab    cues={cues} addCue={addCue} removeCue={removeCue} controlToken={controlToken} />}
        {tab === "settings" && (
          <SettingsTab
            state={state}
            push={push}
            matchId={matchId}
            onEnded={() => router.push("/dashboard")}
          />
        )}
      </div>
    </div>
  );
}

function BrandingUpgradePrompt({ feature }: { readonly feature: string }) {
  return (
    <div data-testid="branding-upgrade-prompt">
      <Card title={feature}>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Team and competition logos, custom colours, fonts and text scale are part of the Pro and Venue plans.
          Upgrading also removes the “Powered by ScoreHub” mark from your displays.
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
          An Admin can upgrade under <a href="/account/billing" style={{ color: "var(--accent)" }}>Account → Billing</a>.
        </p>
      </Card>
    </div>
  );
}
