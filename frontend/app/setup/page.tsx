"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { SPORT_TEMPLATES, getTemplate } from "../sport-templates";
import type { SportType, CricketInningsState } from "../types";
import { useControlToken } from "../hooks/useControlToken";
import { useMatchState } from "../hooks/useMatchState";
import { CricketSquadSetup, emptySquad } from "../control/components/CricketSquadSetup";
import { PlanBadge } from "../components/PlanBadge";
import { OrgSwitcher } from "../components/OrgSwitcher";

function defaultSportConfig(sport: SportType): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const field of getTemplate(sport).matchConfig ?? []) defaults[field.key] = field.defaultValue;
  return defaults;
}

type SetupState = "form" | "squad-entry" | "provisioning" | "applying" | "upgrade-required" | "error";

export default function SetupPage() {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession({
    required: true,
    onUnauthenticated() {
      router.push("/login?callbackUrl=/setup");
    },
  });
  const orgId = session?.user?.activeOrgId;

  const [sport, setSport] = useState<SportType>("netball");
  const [matchName, setMatchName] = useState("");
  const [homeName, setHomeName] = useState("");
  const [visitorName, setVisitorName] = useState("");
  const [sportConfig, setSportConfig] = useState<Record<string, string>>(() => defaultSportConfig("netball"));
  const [state, setState] = useState<SetupState>("form");
  const [message, setMessage] = useState("");
  const [homeSquad, setHomeSquad] = useState<string[]>(emptySquad());
  const [visitorSquad, setVisitorSquad] = useState<string[]>(emptySquad());
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const formErrors = {
    matchName: matchName.trim() ? "" : "Match name is required",
    homeName: homeName.trim() ? "" : "Home team name is required",
    visitorName: visitorName.trim() ? "" : "Visitor team name is required",
  };
  const formValid = !Object.values(formErrors).some(Boolean);
  const touch = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const [matchId, setMatchId] = useState<string | null>(null);
  const controlToken = useControlToken(matchId ?? undefined);
  const { state: matchState, status: connStatus, sendManualUpdate } = useMatchState(
    state === "applying" && controlToken ? { secret: controlToken, role: "control" } : undefined
  );

  // Reset sport-specific config to template defaults when the sport changes
  function selectSport(next: SportType) {
    if (next === sport) return;
    setSport(next);
    setSportConfig(defaultSportConfig(next));
  }

  // Once the socket is connected (only mounted once the form is submitted),
  // push the chosen sport/names and move on — the relay's manualUpdate
  // patch is the only way to set match fields, there's no REST write path.
  // We must await the relay's ack before navigating: router.push unmounts
  // this page, which disconnects the socket, and a fire-and-forget emit can
  // be dropped if that happens before the relay finishes applying it.
  useEffect(() => {
    if (state !== "applying" || connStatus !== "connected") return;
    const template = getTemplate(sport);
    const freshInnings: CricketInningsState = {
      battingTeam: "home", runs: 0, wickets: 0, oversComplete: 0, ballsThisOver: 0,
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0 },
      batters: [], bowlers: [], currentBatter1Index: 0, currentBatter2Index: 1, currentBowlerIndex: 0,
      thisOverBalls: [],
    };
    sendManualUpdate({
      sport,
      matchName: matchName.trim(),
      clockSeconds: template.clockSeconds,
      countDown: template.countDown,
      period: "1",
      possession: template.defaultPossession,
      home: { ...matchState.home, name: homeName.trim(), timeouts: template.timeoutsPerTeam },
      visitor: { ...matchState.visitor, name: visitorName.trim(), timeouts: template.timeoutsPerTeam },
      ...(Object.keys(sportConfig).length > 0 && { sportConfig }),
      ...(sport === "cricket" && {
        sportState: {
          sport: "cricket",
          format: (sportConfig.format as "t20" | "odi" | "test") ?? "t20",
          inningsNumber: 1,
          innings: [freshInnings],
          homeSquad: homeSquad.filter(n => n.trim()).map((name, id) => ({ id, name: name.trim() })),
          visitorSquad: visitorSquad.filter(n => n.trim()).map((name, id) => ({ id, name: name.trim() })),
        },
      }),
    }).then(() => {
      router.push(`/control?matchId=${matchId}`);
    });
    // Deliberately keyed on the state/connection transition only. The patch must
    // be sent once when the socket connects: matchState and sendManualUpdate
    // change identity on every relay broadcast (including the one this patch
    // triggers), so listing them would re-send the patch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, connStatus]);

  async function handleSubmit() {
    if (!orgId) return;
    setState("provisioning");
    try {
      const res = await fetch(`/api/orgs/${orgId}/matches`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setState("upgrade-required");
        setMessage(body?.error ?? "Upgrade required to start a new match.");
        return;
      }
      if (!res.ok || !body?.id) {
        setState("error");
        setMessage(body?.error ?? "Couldn't set up your match — try again.");
        return;
      }
      setMatchId(body.id);
      setState("applying");
    } catch {
      setState("error");
      setMessage("Couldn't reach the scoring service — try again.");
    }
  }

  if (authStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
        <div className="text-sm" style={{ color: "var(--text-dim)" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <div
        className="flex items-center justify-between gap-4 px-6 py-4 flex-wrap"
        style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}
      >
        <span className="font-black text-lg tracking-tight">
          Score<span style={{ color: "var(--accent)" }}>Hub</span>
        </span>
        <div className="flex items-center gap-3 flex-wrap">
          <PlanBadge />
          <OrgSwitcher />
          {session?.user?.name && (
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>{session.user.name}</span>
          )}
          <a
            href="/dashboard"
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", textDecoration: "none" }}
          >
            Dashboard
          </a>
          <a
            href="/account"
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", textDecoration: "none" }}
          >
            Account
          </a>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-6 sm:p-10">
        <h1 className="text-2xl font-black tracking-tight mb-1">Set up your match</h1>
        <p className="text-sm mb-8" style={{ color: "var(--text-secondary)" }}>
          Pick a sport and name your teams — you can change any of this later from the Control Panel.
        </p>

        {(state === "provisioning" || state === "applying") && (
          <div
            className="rounded-2xl p-6 text-sm"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-dim)" }}
          >
            Setting up your match…
          </div>
        )}

        {state === "upgrade-required" && (
          <div
            className="rounded-2xl p-6 text-sm font-semibold"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--danger)" }}
          >
            {message}{" "}
            <a href="/account/billing" style={{ color: "var(--accent)", textDecoration: "underline" }}>
              Upgrade plan
            </a>
          </div>
        )}

        {state === "error" && (
          <div
            className="rounded-2xl p-6 text-sm font-semibold"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--danger)" }}
          >
            {message}
          </div>
        )}

        {state === "form" && (
          <div className="space-y-6">
            <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: "var(--text-dim)" }}>Sport</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SPORT_TEMPLATES.map(t => (
                  <button
                    key={t.sport}
                    data-testid={`sport-tile-${t.sport}`}
                    className="rounded-lg px-3 py-2 text-left"
                    style={{
                      background: sport === t.sport ? "var(--accent-dim)" : "var(--bg-elevated)",
                      border: `1px solid ${sport === t.sport ? "var(--border-accent)" : "var(--border)"}`,
                      color: sport === t.sport ? "var(--accent)" : "var(--text-secondary)",
                    }}
                    onClick={() => selectSport(t.sport)}
                  >
                    <div className="text-sm font-semibold">{t.label}</div>
                    <div className="text-xs mt-0.5" style={{ opacity: 0.85 }}>{t.structure}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Sport-specific config fields (e.g. match format for Squash, wicket penalty for Indoor Cricket) */}
            {getTemplate(sport).matchConfig?.map(field => (
              <div key={field.key} className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: "var(--text-dim)" }}>{field.label}</p>
                <div className="flex flex-wrap gap-2">
                  {field.options.map(opt => (
                    <button
                      key={opt.value}
                      data-testid={`match-config-${field.key}-${opt.value}`}
                      className="rounded-lg px-4 py-2 text-left"
                      style={{
                        background: sportConfig[field.key] === opt.value ? "var(--accent-dim)" : "var(--bg-elevated)",
                        border: `1px solid ${sportConfig[field.key] === opt.value ? "var(--border-accent)" : "var(--border)"}`,
                        color: sportConfig[field.key] === opt.value ? "var(--accent)" : "var(--text-secondary)",
                      }}
                      onClick={() => setSportConfig(prev => ({ ...prev, [field.key]: opt.value }))}
                    >
                      <div className="text-sm font-semibold">{opt.label}</div>
                      {opt.description && <div className="text-xs mt-0.5" style={{ opacity: 0.7 }}>{opt.description}</div>}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="rounded-xl p-5 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <SetupField
                label="Match name" placeholder="e.g. Round 1" value={matchName} onChange={setMatchName} testId="setup-match-name"
                error={touched.matchName ? formErrors.matchName : ""} onBlur={() => touch("matchName")}
              />
              <SetupField
                label="Home team" placeholder="e.g. Home" value={homeName} onChange={setHomeName} testId="setup-home-name"
                error={touched.homeName ? formErrors.homeName : ""} onBlur={() => touch("homeName")}
              />
              <SetupField
                label="Visitor team" placeholder="e.g. Visitor" value={visitorName} onChange={setVisitorName} testId="setup-visitor-name"
                error={touched.visitorName ? formErrors.visitorName : ""} onBlur={() => touch("visitorName")}
              />
            </div>

            <button
              data-testid="setup-submit"
              className="w-full rounded-xl py-3 text-sm font-black tracking-widest uppercase transition-opacity"
              style={{
                background: "var(--accent-dim)",
                border: "1px solid var(--border-accent)",
                color: "var(--accent)",
                opacity: !orgId || !formValid ? 0.5 : 1,
                cursor: !orgId || !formValid ? "not-allowed" : "pointer",
              }}
              onClick={() => sport === "cricket" ? setState("squad-entry") : handleSubmit()}
              disabled={!orgId || !formValid}
            >
              {sport === "cricket" ? "Next: Squads →" : "Start Match →"}
            </button>
          </div>
        )}

        {state === "squad-entry" && (
          <CricketSquadSetup
            homeTeamName={homeName}
            visitorTeamName={visitorName}
            homeSquad={homeSquad}
            visitorSquad={visitorSquad}
            onChangeHome={(idx, name) => setHomeSquad(prev => prev.map((n, i) => i === idx ? name : n))}
            onChangeVisitor={(idx, name) => setVisitorSquad(prev => prev.map((n, i) => i === idx ? name : n))}
            onBack={() => setState("form")}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}

function SetupField({ label, placeholder, value, onChange, testId, error, onBlur }: {
  readonly label: string; readonly placeholder: string; readonly value: string; readonly onChange: (v: string) => void; readonly testId?: string;
  readonly error?: string; readonly onBlur?: () => void;
}) {
  return (
    <div>
      <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>{label}</p>
      <input
        data-testid={testId}
        className="w-full rounded-lg px-3 py-2 text-sm font-semibold"
        style={{
          background: "var(--bg-elevated)",
          border: `1px solid ${error ? "var(--danger)" : "var(--border)"}`,
          color: "var(--text-primary)",
          outline: "none",
        }}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={!!error}
      />
      {error && (
        <p className="mt-1 text-xs font-semibold" style={{ color: "var(--danger)" }}>{error}</p>
      )}
    </div>
  );
}
