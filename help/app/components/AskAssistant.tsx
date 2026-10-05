"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerText } from "./AnswerText";

// Other components open the panel (optionally with a question) by
// dispatching this event; see AskTrigger.tsx.
export const ASK_EVENT = "scorehub:ask";
const ESCALATE_TOKEN = "[[ESCALATE]]";
const SUPPORT_EMAIL = "hello@scorehub.co.nz";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

type View = "chat" | "case" | "sent";

// Who the app says is signed in. "loading" while asking; "error" when the
// app can't be reached, in which case only email is left to offer.
interface SupportUser {
  name: string;
  email: string;
  organisation: string;
}
type Account = SupportUser | "loading" | "signed-out" | "error";

// Support requests are filed by the app, under the visitor's app login. The
// app sits beside this site on the same parent domain (help.X ↔ app.X), so
// the browser sends its session cookie on these cross-origin calls.
function appUrl(): string {
  const { hostname } = window.location;
  if (hostname.startsWith("help.")) return `https://app.${hostname.slice("help.".length)}`;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
// "asking": waiting on the model. "answered": show "did that help?".
// "escalate": the assistant couldn't settle it. "down": assistant unavailable.
type ChatState = "idle" | "asking" | "answered" | "escalate" | "resolved" | "down";

const CATEGORIES = [
  { value: "setup", label: "Setup help" },
  { value: "live-match", label: "Live-match problem" },
  { value: "bridge", label: "Bridge or console" },
  { value: "billing", label: "Billing" },
  { value: "account", label: "Account" },
];

// Carries the conversation across the full-page login redirect (the fallback
// when the pop-up login window is blocked).
const RESUME_KEY = "scorehub:ask:resume";

const SUGGESTIONS = [
  "How do I get my score onto a venue screen?",
  "What does the Free plan include?",
  "How do I connect a scoring console?",
];

// Hide the escalation marker, including a partial one still streaming in.
function visibleText(raw: string): string {
  const full = raw.indexOf("[[");
  if (full !== -1 && ESCALATE_TOKEN.startsWith(raw.slice(full).trimEnd())) {
    return raw.slice(0, full).trimEnd();
  }
  return raw.replace(ESCALATE_TOKEN, "").trimEnd();
}

export function AskAssistant() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [draft, setDraft] = useState("");
  const [caseKey, setCaseKey] = useState<string | null>(null);
  const [caseError, setCaseError] = useState<"invalid" | "failed" | null>(null);
  const [sending, setSending] = useState(false);
  const [account, setAccount] = useState<Account>("loading");

  const turnsRef = useRef<Turn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const update = useCallback((next: Turn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || abortRef.current) return;
      conversationRef.current ||= crypto.randomUUID();
      const history = [...turnsRef.current, { role: "user" as const, content: q }];
      update([...history, { role: "assistant", content: "" }]);
      setDraft("");
      setView("chat");
      setChatState("asking");

      const controller = new AbortController();
      abortRef.current = controller;
      let answer = "";
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, conversationId: conversationRef.current }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`ask failed: ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          answer += decoder.decode(value, { stream: true });
          update([...history, { role: "assistant", content: visibleText(answer) }]);
        }
        if (!answer.trim()) throw new Error("empty answer");
        setChatState(answer.includes(ESCALATE_TOKEN) ? "escalate" : "answered");
      } catch {
        if (controller.signal.aborted) return;
        // Drop the empty assistant bubble; the question stays for the case form.
        update(answer.trim() ? [...history, { role: "assistant", content: visibleText(answer) }] : history);
        setChatState("down");
      } finally {
        abortRef.current = null;
      }
    },
    [update],
  );

  // Two ways a page load can start with the panel open. ?ask=… is a question
  // submitted from the home page before hydration: answer it. ?contact=1 is
  // the return from the login redirect: reopen the support form with the
  // conversation that was in progress. Either way, tidy the URL afterwards so
  // a refresh doesn't repeat it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const question = params.get("ask");
    const resuming = params.get("contact") === "1";
    if (!question && !resuming) return;
    window.history.replaceState(null, "", window.location.pathname);
    setOpen(true);
    if (question) return void ask(question);
    try {
      const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null") as {
        turns?: Turn[];
        conversationId?: string;
      } | null;
      sessionStorage.removeItem(RESUME_KEY);
      if (Array.isArray(saved?.turns)) update(saved.turns);
      conversationRef.current = saved?.conversationId ?? "";
    } catch {
      // No saved conversation is fine; the form just starts empty.
    }
    setView("case");
  }, [ask, update]);

  useEffect(() => {
    function onAsk(event: Event) {
      const question = (event as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      if (question) void ask(question);
    }
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, [ask]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    if (view === "chat") inputRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, view]);

  const checkAccount = useCallback(async () => {
    try {
      const res = await fetch(`${appUrl()}/api/support/session`, { credentials: "include" });
      if (!res.ok) throw new Error(`session check failed: ${res.status}`);
      const { user } = (await res.json()) as { user: SupportUser | null };
      setAccount(user ?? "signed-out");
    } catch {
      setAccount("error");
    }
  }, []);

  // Ask the app who's signed in whenever the case form is showing, and again
  // when the visitor comes back to this tab after logging in in another one.
  useEffect(() => {
    if (!open || view !== "case") return;
    void checkAccount();
    window.addEventListener("focus", checkAccount);
    return () => window.removeEventListener("focus", checkAccount);
  }, [open, view, checkAccount]);

  // Log in without losing the page: a small window on the app's login that
  // closes itself when done (/login/complete), after which we re-check who's
  // signed in. If the browser blocks pop-ups, fall back to a full redirect
  // to the login page and back, stashing the conversation for the return.
  function logIn(event: React.MouseEvent<HTMLAnchorElement>) {
    const popup = window.open(
      `${appUrl()}/login?callbackUrl=${encodeURIComponent("/login/complete")}`,
      "scorehub-login",
      "popup,width=460,height=720",
    );
    if (!popup) {
      try {
        sessionStorage.setItem(
          RESUME_KEY,
          JSON.stringify({ turns: turnsRef.current, conversationId: conversationRef.current }),
        );
      } catch {
        // Storage can be unavailable (private mode); the redirect still works.
      }
      return; // let the link navigate
    }
    event.preventDefault();
    const watch = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(watch);
      void checkAccount();
    }, 500);
  }

  // Records what happened after an answer, for measuring deflection.
  const report = useCallback((type: "resolved" | "unresolved" | "case_filed", key?: string | null) => {
    if (!conversationRef.current) return;
    void fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, key, conversationId: conversationRef.current }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, chatState, view]);

  function startOver() {
    abortRef.current?.abort();
    abortRef.current = null;
    conversationRef.current = "";
    update([]);
    setChatState("idle");
    setView("chat");
    setCaseKey(null);
    setCaseError(null);
  }

  async function submitCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSending(true);
    setCaseError(null);
    try {
      const res = await fetch(`${appUrl()}/api/support/case`, {
        method: "POST",
        credentials: "include",
        // text/plain keeps this a "simple" cross-origin request with no CORS
        // preflight; a preflight carries no cookies, so UAT's Cloudflare
        // Access gate in front of the app would reject it. The app parses
        // the body as JSON regardless.
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          ...Object.fromEntries(form),
          page: window.location.href,
          transcript: turnsRef.current.filter(t => t.content),
          conversationId: conversationRef.current || undefined,
        }),
      });
      // The session ended between opening the form and sending it.
      if (res.status === 401) return setAccount("signed-out");
      if (res.status === 400) return setCaseError("invalid");
      if (!res.ok) return setCaseError("failed");
      const { key } = (await res.json()) as { key: string | null };
      setCaseKey(key);
      report("case_filed", key);
      setView("sent");
    } catch {
      setCaseError("failed");
    } finally {
      setSending(false);
    }
  }

  const firstQuestion = turns.find(t => t.role === "user")?.content ?? "";
  const busy = chatState === "asking";

  if (!open) {
    return (
      <button type="button" className="ask-launcher" onClick={() => setOpen(true)}>
        <span aria-hidden="true" className="ask-spark" />
        Ask a question
      </button>
    );
  }

  return (
    <section className="ask-panel" role="dialog" aria-label="ScoreHub help assistant">
      <header className="ask-header">
        <div>
          <strong>{view === "chat" ? "Ask ScoreHub" : "Contact support"}</strong>
          <span>{view === "chat" ? "Answers from the help centre" : "A person will reply by email"}</span>
        </div>
        <div className="ask-header-actions">
          {turns.length > 0 && (
            <button type="button" onClick={startOver}>
              Start over
            </button>
          )}
          <button type="button" aria-label="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
      </header>

      <div className="ask-body" ref={scrollRef}>
        {view === "chat" && (
          <>
            {turns.length === 0 && (
              <div className="ask-empty">
                <p>Ask anything about setting up, scoring, displays, billing or your account.</p>
                <p className="ask-note">Questions and answers are recorded to improve our help.</p>
                {SUGGESTIONS.map(s => (
                  <button key={s} type="button" className="ask-chip" onClick={() => void ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div aria-live="polite">
              {turns.map((turn, i) =>
                turn.role === "user" ? (
                  <p key={i} className="ask-question">
                    {turn.content}
                  </p>
                ) : (
                  <div key={i} className="ask-answer">
                    {turn.content ? (
                      <AnswerText text={turn.content} />
                    ) : (
                      <span className="ask-typing" aria-label="Thinking">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </div>
                ),
              )}
            </div>

            {chatState === "answered" && (
              <div className="ask-feedback">
                <span>Did that answer your question?</span>
                <button
                  type="button"
                  onClick={() => {
                    report("resolved");
                    setChatState("resolved");
                  }}
                >
                  Yes, thanks
                </button>
                <button
                  type="button"
                  onClick={() => {
                    report("unresolved");
                    setView("case");
                  }}
                >
                  No, contact support
                </button>
              </div>
            )}
            {chatState === "resolved" && <p className="ask-note">Glad that helped. Ask another any time.</p>}
            {chatState === "escalate" && (
              <div className="ask-handoff">
                <p>This one needs a person. Send it to the ScoreHub team and we'll pick it up from here.</p>
                <button type="button" className="ask-primary" onClick={() => setView("case")}>
                  Contact support
                </button>
              </div>
            )}
            {chatState === "down" && (
              <div className="ask-handoff">
                <p>The assistant isn't available right now. You can send your question straight to the team.</p>
                <button type="button" className="ask-primary" onClick={() => setView("case")}>
                  Contact support
                </button>
              </div>
            )}
          </>
        )}

        {view === "case" && account === "loading" && <p className="ask-note">Checking your login…</p>}

        {view === "case" && account === "signed-out" && (
          <div className="ask-handoff">
            <p>
              Log in to send a support request. That way it reaches us with your organisation and plan
              attached, and we know it's really you.
            </p>
            <a
              className="ask-primary"
              href={`${appUrl()}/login?callbackUrl=${encodeURIComponent(
                `${window.location.origin}${window.location.pathname}?contact=1`,
              )}`}
              onClick={logIn}
            >
              Log in to contact support
            </a>
            <p className="ask-note">
              You'll come straight back here. <a href={`${appUrl()}/login?support=1`}>Can't log in?</a>
            </p>
            <button type="button" className="ask-skip" onClick={() => setView("chat")}>
              Back to the assistant
            </button>
          </div>
        )}

        {view === "case" && account === "error" && (
          <div className="ask-handoff">
            <p>
              We couldn't reach your ScoreHub account just now. Email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we'll pick it up.
            </p>
            <button type="button" className="ask-primary" onClick={() => void checkAccount()}>
              Try again
            </button>
          </div>
        )}

        {view === "case" && typeof account === "object" && (
          <form className="ask-case" onSubmit={submitCase}>
            <p className="ask-identity">
              Sending as <strong>{account.name || account.email}</strong>
              {account.organisation ? ` · ${account.organisation}` : ""}
              <span>{account.email}</span>
            </p>
            <label>
              What's it about?
              <select name="category" defaultValue="setup">
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Summary
              <input name="summary" required maxLength={200} defaultValue={firstQuestion.slice(0, 200)} />
            </label>
            <label>
              Details
              <textarea
                name="details"
                rows={4}
                maxLength={4000}
                placeholder="What you expected, what happened, and a match link if it's about a live match."
              />
            </label>
            {/* Honeypot: hidden from people, tempting to bots. */}
            <input name="website" tabIndex={-1} autoComplete="off" className="ask-hp" aria-hidden="true" />
            {turns.length > 0 && <p className="ask-note">Your conversation with the assistant is included.</p>}
            {caseError === "invalid" && (
              <p className="ask-error" role="alert">
                Add a short summary, then try again.
              </p>
            )}
            {caseError === "failed" && (
              <p className="ask-error" role="alert">
                We couldn't send that. Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> instead and
                we'll pick it up.
              </p>
            )}
            <div className="ask-case-actions">
              <button type="button" onClick={() => setView("chat")}>
                Back
              </button>
              <button type="submit" className="ask-primary" disabled={sending}>
                {sending ? "Sending…" : "Send to support"}
              </button>
            </div>
          </form>
        )}

        {view === "sent" && (
          <div className="ask-sent">
            <h2>Request sent</h2>
            <p>
              {caseKey ? (
                <>
                  Your reference is <strong>{caseKey}</strong>.{" "}
                </>
              ) : null}
              We'll reply by email.
            </p>
            <button type="button" className="ask-primary" onClick={startOver}>
              Ask something else
            </button>
          </div>
        )}
      </div>

      {view === "chat" && (
        <form
          className="ask-composer"
          onSubmit={e => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={1000}
            placeholder={turns.length ? "Ask a follow-up…" : "Type your question…"}
            aria-label="Your question"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
          />
          <button type="submit" className="ask-primary" disabled={busy || !draft.trim()}>
            Ask
          </button>
          {chatState !== "escalate" && chatState !== "down" && (
            <button type="button" className="ask-skip" onClick={() => setView("case")}>
              Contact support instead
            </button>
          )}
        </form>
      )}
    </section>
  );
}
