"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { MatchState } from "../../types";
import { SPORT_TEMPLATES, getMatchTemplate, getStructureLabel, matchFormat } from "../../sport-templates";
import { RELAY_URL } from "../lib/relay";
import { useEndMatch } from "../lib/useEndMatch";
import { Card, ColorSwatch, TemplateRow } from "./primitives";

function templateClockLabel(clockSeconds: number, countDown: boolean): string {
  if (clockSeconds === 0) {
    return countDown ? "0:00 (no clock)" : "Counts up from 0:00";
  }
  const direction = countDown ? "Counts down from" : "Counts up from";
  const minutes = Math.floor(clockSeconds / 60);
  const seconds = String(clockSeconds % 60).padStart(2, "0");
  return `${direction} ${minutes}:${seconds}`;
}

// The Control API's per-match endpoint URLs. Tokens themselves are org-wide
// and live on the Account page, alongside Bridge and Data Feed tokens.
function ControlApiCard({ matchId }: { readonly matchId?: string }) {
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
    <Card title="Control API">
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        This match&apos;s endpoint URLs, for a Stream Deck HTTP action or any HTTP client. Send a
        Stream Deck token as the <code>x-control-secret</code> header — tokens are
        under <a href="/account" style={{ color: "var(--accent)" }}>Account → Stream Deck / Control API</a>.
      </p>
      <div className="space-y-1">
        {actions.map(a => (
          <div key={a.label} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 font-semibold" style={{ color: "var(--text-secondary)" }}>{a.label}</span>
            <code
              className="flex-1 min-w-0 p-1.5 rounded truncate"
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
    </Card>
  );
}

// A text field showing the setting's current value. Set (or Enter) saves a
// real change only: a blank or unchanged value is dropped rather than
// wiping the name. Until the operator types, it follows the live value, so
// a rename from another panel shows up here.
function TextSetting({ label, value, placeholder, onSave, testId }: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly onSave: (value: string) => void;
  readonly testId: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function save() {
    const next = draft?.trim();
    if (next && next !== value) onSave(next);
    setDraft(null);
  }
  return (
    <div className="mb-4">
      <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>{label}</p>
      <div className="flex gap-2">
        <input
          data-testid={testId}
          aria-label={label}
          className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm font-semibold"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
          value={draft ?? value}
          placeholder={placeholder}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === "Enter" && save()}
        />
        <button
          data-testid={`${testId}-set`}
          className="rounded-lg px-3 py-2 text-xs font-bold"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
          onClick={save}
        >
          Set
        </button>
      </div>
    </div>
  );
}

export function SettingsTab({ state, push, matchId, onEnded }: {
  readonly state: MatchState;
  readonly push: (p: Partial<MatchState>) => void | Promise<void>;
  readonly matchId?: string;
  readonly onEnded?: () => void;
}) {
  const template = getMatchTemplate(state);
  // Only offered where the format is just a different template (Netball /
  // Fast5) — cricket's and softball's formats are baked into their sportState.
  const formatField = template.formats ? template.matchConfig?.find(f => f.key === "format") : undefined;
  const currentFormat = matchFormat(state) ?? formatField?.defaultValue ?? "";
  const { data: session } = useSession();
  const { endMatch: handleEndMatch, ending, endError } = useEndMatch({ matchId, isRunning: state.isRunning, push, onEnded });

  function selectFormat(format: string) {
    const sportConfig = { ...state.sportConfig, format };
    // Bring the clock along if it's still sitting untouched on the old
    // format's opening value; anything else is the operator's to change.
    const untouched = !state.isRunning && state.period === "1" && state.clockSeconds === template.clockSeconds;
    void push({ sportConfig, ...(untouched && { clockSeconds: getMatchTemplate({ sport: state.sport, sportConfig }).clockSeconds }) });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {/* Teams — name and colour */}
      <Card title="Home Team">
        <TextSetting label="Name" value={state.home.name} placeholder="Home" testId="settings-home-name"
          onSave={name => push({ home: { ...state.home, name } })} />
        <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>Colour</p>
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

      <Card title="Visitor Team">
        <TextSetting label="Name" value={state.visitor.name} placeholder="Visitor" testId="settings-visitor-name"
          onSave={name => push({ visitor: { ...state.visitor, name } })} />
        <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>Colour</p>
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

      <Card title="Match Name">
        <TextSetting label="Name" value={state.matchName} placeholder="e.g. Round 1"
          testId="settings-match-name" onSave={matchName => push({ matchName })} />
      </Card>

      {/* Sport — fixed once a match is set up (the relay drops a sport change
          for a real match); only the legacy single room picks it here */}
      {matchId ? (
        <Card title="Sport">
          <div data-testid="settings-sport" className="text-sm font-semibold" style={{ color: "var(--accent)" }}>{template.label}</div>
          <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
            A match&apos;s sport can&apos;t be changed once it&apos;s set up. To score a different sport,{" "}
            <a href="/setup" style={{ color: "var(--accent)" }}>set up a new match</a>.
          </p>
        </Card>
      ) : (
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
      )}

      {/* Format — for fixtures, which don't pass through /setup's options */}
      {formatField && (
        <Card title={formatField.label}>
          <div className="flex flex-wrap gap-2">
            {formatField.options.map(opt => (
              <button key={opt.value}
                data-testid={`settings-format-${opt.value}`}
                className="rounded-lg px-4 py-2 text-left"
                style={{
                  background: currentFormat === opt.value ? "var(--accent-dim)" : "var(--bg-elevated)",
                  border: `1px solid ${currentFormat === opt.value ? "var(--border-accent)" : "var(--border)"}`,
                  color: currentFormat === opt.value ? "var(--accent)" : "var(--text-secondary)",
                }}
                onClick={() => selectFormat(opt.value)}
              >
                <div className="text-sm font-semibold">{opt.label}</div>
                {opt.description && <div className="text-xs mt-0.5" style={{ opacity: 0.7 }}>{opt.description}</div>}
              </button>
            ))}
          </div>
        </Card>
      )}

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
          need this for the Control API, or if support asks you to set it under <strong>Advanced</strong>.
        </p>
        <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
          Tokens for Bridge, Stream Deck and the data feed are on the <a href="/account" style={{ color: "var(--accent)" }}>Account</a> page.
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

      {(session?.user?.activeRole === "ADMIN" || session?.user?.activeRole === "MANAGER") && (
        <ControlApiCard matchId={matchId} />
      )}
    </div>
  );
}
