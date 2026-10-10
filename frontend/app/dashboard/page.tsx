"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { PlanBadge } from "../components/PlanBadge";
import { OrgSwitcher } from "../components/OrgSwitcher";
import { SPORT_TEMPLATES } from "../sport-templates";
import { formatFixtureTime, localFixtureTimeToUtc, localTimeZoneLabel } from "@/lib/fixtureTime";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (globalThis.window !== undefined ? globalThis.location.origin : "");

type MatchStatus = "SCHEDULED" | "LIVE" | "ENDED";
type TabKey = "upcoming" | "live" | "history";

interface MatchRow {
  id: string;
  status: MatchStatus;
  sport: string | null;
  competition: string | null;
  homeName: string | null;
  visitorName: string | null;
  scheduledAt: string | null;
  createdAt: string;
  endedAt: string | null;
  displayToken: string | null;
}

const TAB_STATUS: Record<TabKey, MatchStatus> = {
  upcoming: "SCHEDULED",
  live: "LIVE",
  history: "ENDED",
};

interface FixtureRow {
  sport: string;
  competition?: string;
  home: string;
  visitor: string;
  scheduledAt?: string;
  matchName?: string;
}

// Minimal CSV parser — header row + comma-separated values, no quoted-comma
// support. Good enough for the sport/competition/home/visitor/scheduledAt
// format documented on the upload panel; anything fancier (Excel exports
// with embedded commas) can be pasted into a spreadsheet and re-saved.
//
// scheduledAt comes back as a UTC instant: a CSV time has no timezone of its
// own, so it's read in this browser's timezone here (see lib/fixtureTime.ts).
function parseFixtureCsv(text: string): { rows: FixtureRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { rows: [], errors: ["empty file"] };
  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  const rows: FixtureRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map(c => c.trim());
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => { rec[h] = cells[idx] ?? ""; });
    if (!rec.sport || !rec.home || !rec.visitor) {
      errors.push(`row ${i}: missing sport/home/visitor`);
      continue;
    }
    const scheduledAt = rec.scheduledat ? localFixtureTimeToUtc(rec.scheduledat) : undefined;
    if (scheduledAt === null) {
      errors.push(`row ${i}: unreadable date "${rec.scheduledat}" — use YYYY-MM-DDTHH:MM`);
      continue;
    }
    rows.push({
      sport: rec.sport,
      competition: rec.competition || undefined,
      home: rec.home,
      visitor: rec.visitor,
      scheduledAt,
      matchName: rec.matchname || undefined,
    });
  }
  return { rows, errors };
}

async function fetchMatches(
  orgId: string,
  tab: TabKey,
  sportFilter: string,
  competitionFilter: string,
  search: string,
): Promise<MatchRow[]> {
  const params = new URLSearchParams({ status: TAB_STATUS[tab] });
  if (sportFilter) params.set("sport", sportFilter);
  if (competitionFilter) params.set("competition", competitionFilter);
  if (search.trim()) params.set("q", search.trim());
  const res = await fetch(`/api/orgs/${orgId}/matches?${params.toString()}`);
  const body = await res.json().catch(() => ({}));
  return res.ok ? body.matches ?? [] : [];
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession({
    required: true,
    onUnauthenticated() {
      router.push("/login?callbackUrl=/dashboard");
    },
  });
  const orgId = session?.user?.activeOrgId;

  const [tab, setTab] = useState<TabKey>("live");
  const [sportFilter, setSportFilter] = useState("");
  const [competitionFilter, setCompetitionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [reopenError, setReopenError] = useState("");

  const { data: matches = [], isLoading: loading, mutate: load } = useSWR(
    orgId ? [orgId, tab, sportFilter, competitionFilter, search] : null,
    () => fetchMatches(orgId as string, tab, sportFilter, competitionFilter, search),
  );

  const competitions = useMemo(
    () => Array.from(new Set(matches.map(m => m.competition).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b)),
    [matches]
  );

  function copy(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  // An ended match is read-only; reopening it makes it live again so the
  // score can be corrected, then End Match puts it back in History.
  async function reopen(matchId: string) {
    if (!orgId) return;
    if (!confirm("Reopen this match? It becomes live again so you can correct it — end it again when you're done.")) return;
    setReopeningId(matchId);
    setReopenError("");
    try {
      const res = await fetch(`/api/orgs/${orgId}/matches/${matchId}/reopen`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setReopenError(body?.error ?? "Couldn't reopen the match — try again.");
        return;
      }
      router.push(`/control?matchId=${matchId}`);
    } catch {
      setReopenError("Couldn't reach the server — try again.");
    } finally {
      setReopeningId(null);
    }
  }

  const canRunMatches = session?.user?.activeRole !== undefined && session.user.activeRole !== "VIEWER";

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
            href="/account"
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", textDecoration: "none" }}
          >
            Account
          </a>
          <a
            href="https://help.scorehub.co.nz"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", textDecoration: "none" }}
          >
            Help
          </a>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Sign out
          </button>
          <a
            href="/setup"
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)", textDecoration: "none" }}
          >
            Set Up a New Match
          </a>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 sm:p-10">
        <h1 className="text-2xl font-black tracking-tight mb-1">Matches</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          Upcoming fixtures, live matches, and history — click into a match to score it.
        </p>

        <div className="flex gap-1 mb-4" style={{ borderBottom: "1px solid var(--border)" }}>
          {(["live", "upcoming", "history"] as TabKey[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 text-sm font-bold tracking-wide capitalize rounded-t-lg"
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

        <div className="flex flex-wrap gap-2 mb-4">
          <select
            className="rounded-lg px-3 py-2 text-xs"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            value={sportFilter}
            onChange={e => setSportFilter(e.target.value)}
          >
            <option value="">All sports</option>
            {SPORT_TEMPLATES.map(t => <option key={t.sport} value={t.sport}>{t.label}</option>)}
          </select>
          <select
            className="rounded-lg px-3 py-2 text-xs"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            value={competitionFilter}
            onChange={e => setCompetitionFilter(e.target.value)}
          >
            <option value="">All competitions</option>
            {competitions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="text"
            placeholder="Search team name…"
            className="rounded-lg px-3 py-2 text-xs flex-1 min-w-[10rem]"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {tab === "upcoming" && (
            <button
              onClick={() => setUploadOpen(v => !v)}
              className="rounded-lg px-3 py-2 text-xs font-bold whitespace-nowrap"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              {uploadOpen ? "Close Upload" : "Upload Fixtures"}
            </button>
          )}
        </div>

        {tab === "upcoming" && uploadOpen && orgId && (
          <FixtureUpload orgId={orgId} onDone={() => { setUploadOpen(false); load(); }} />
        )}

        {reopenError && (
          <p role="alert" className="text-xs mb-3 font-semibold" style={{ color: "var(--danger)" }}>{reopenError}</p>
        )}

        {loading ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>Loading…</p>
        ) : matches.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>No matches here yet.</p>
        ) : (
          <div className="space-y-2">
            {matches.map(m => {
              const title = `${m.homeName || "Home"} v ${m.visitorName || "Visitor"}`;
              const tokenParam = m.displayToken ? `&token=${m.displayToken}` : "";
              const displayUrl = `${SITE_URL}/display/fullscreen?org=${orgId}&matchId=${m.id}${tokenParam}`;
              const clickable = m.status !== "ENDED";
              const controlLinkLabel = m.status === "LIVE" ? "Open Control →" : "Start →";
              return (
                <div
                  key={m.id}
                  className="rounded-xl p-4 flex items-center justify-between gap-4"
                  style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{title}</p>
                    <p className="text-xs truncate" style={{ color: "var(--text-dim)" }}>
                      {m.sport ?? "—"}{m.competition ? ` · ${m.competition}` : ""}
                      {m.scheduledAt ? ` · ${formatFixtureTime(m.scheduledAt)}` : ""}
                      {m.status === "ENDED" && m.endedAt ? ` · ended ${formatFixtureTime(m.endedAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {clickable && (
                      <button
                        onClick={() => copy(displayUrl)}
                        className="rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap"
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                      >
                        {copied === displayUrl ? "Copied!" : "Copy display link"}
                      </button>
                    )}
                    {clickable ? (
                      <a
                        href={`/control?matchId=${m.id}`}
                        className="rounded-lg px-3 py-1.5 text-xs font-black whitespace-nowrap"
                        style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)", textDecoration: "none" }}
                      >
                        {controlLinkLabel}
                      </a>
                    ) : (
                      <>
                        <span className="text-xs font-bold px-3" style={{ color: "var(--text-dim)" }}>Ended</span>
                        {canRunMatches && (
                          <button
                            data-testid={`reopen-match-${m.id}`}
                            onClick={() => reopen(m.id)}
                            disabled={reopeningId === m.id}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap"
                            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                          >
                            {reopeningId === m.id ? "Reopening…" : "Reopen"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FixtureUpload({ orgId, onDone }: { readonly orgId: string; readonly onDone: () => void }) {
  const [rows, setRows] = useState<FixtureRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleFile(file: File) {
    file.text().then(text => {
      const { rows, errors } = parseFixtureCsv(text);
      setRows(rows);
      setParseErrors(errors);
      setSubmitError("");
    });
  }

  async function handleConfirm() {
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(`/api/orgs/${orgId}/matches/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtures: rows }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(body?.error ?? "Upload failed");
        return;
      }
      onDone();
    } catch {
      setSubmitError("Couldn't reach the server — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl p-5 mb-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        CSV with header row: <code>sport,competition,home,visitor,scheduledAt</code> (competition and scheduledAt optional).
      </p>
      <p data-testid="fixture-timezone" className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Times are read in your timezone, <strong>{localTimeZoneLabel()}</strong>, and shown to each person in theirs.
        For a fixture somewhere else, add its offset to the time — for example <code>2026-10-17T18:30+11:00</code>.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
        className="text-xs mb-3"
      />

      {parseErrors.length > 0 && (
        <div className="text-xs mb-3" style={{ color: "var(--danger)" }}>
          {parseErrors.map(e => <p key={e}>{e}</p>)}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
            {rows.map(r => (
              <div key={`${r.sport}-${r.home}-${r.visitor}-${r.scheduledAt ?? ""}`} className="text-xs flex gap-2" style={{ color: "var(--text-secondary)" }}>
                <span>{r.sport}</span>
                <span>·</span>
                <span>{r.home} v {r.visitor}</span>
                {r.competition && <span>· {r.competition}</span>}
                {r.scheduledAt && <span>· {formatFixtureTime(r.scheduledAt)}</span>}
              </div>
            ))}
          </div>
          {submitError && (
            <p className="text-xs mb-3 font-semibold" style={{ color: "var(--danger)" }}>{submitError}</p>
          )}
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-bold"
            style={{ background: "var(--accent-dim)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}
          >
            {submitting ? "Uploading…" : `Upload ${rows.length} Fixtures`}
          </button>
        </>
      )}
    </div>
  );
}
