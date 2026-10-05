"use client";

import { useState } from "react";
import { ASK_EVENT } from "./AskAssistant";

function openAssistant(question?: string) {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { question } }));
}

// The home page's ask box: hands the question to the assistant panel.
export function AskHero() {
  const [question, setQuestion] = useState("");
  return (
    <form
      className="ask-hero"
      // If this is submitted before the page's scripts have loaded, the
      // browser reloads with ?ask=…, which AskAssistant picks up on mount.
      action="/"
      onSubmit={e => {
        e.preventDefault();
        if (!question.trim()) return;
        openAssistant(question);
        setQuestion("");
      }}
    >
      <span aria-hidden="true" className="ask-spark" />
      <input
        name="ask"
        value={question}
        maxLength={1000}
        placeholder="Ask a question, e.g. how do I put my score on a venue screen?"
        aria-label="Ask a question"
        onChange={e => setQuestion(e.target.value)}
      />
      <button type="submit" className="ask-primary">
        Ask
      </button>
    </form>
  );
}

// An inline button for articles, e.g. the Contact support page.
export function AskButton({ children }: { readonly children: React.ReactNode }) {
  return (
    <button type="button" className="ask-primary ask-inline" onClick={() => openAssistant()}>
      {children}
    </button>
  );
}
