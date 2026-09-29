import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import TermsPage from "../page";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

afterEach(cleanup);

describe("/terms", () => {
  it("renders the terms heading", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/terms/i);
  });

  // Signup records CURRENT_TERMS_VERSION as the version a user consented to.
  // If the page's "Last updated" date drifts from it, that record no longer
  // matches what users were actually shown.
  it("shows a 'Last updated' date that matches CURRENT_TERMS_VERSION", () => {
    render(<TermsPage />);
    const shown = /Last updated:\s*(\d{1,2} \w+ \d{4})/.exec(document.body.textContent ?? "");
    expect(shown).not.toBeNull();
    const iso = new Date(`${shown![1]} UTC`).toISOString().slice(0, 10);
    expect(iso).toBe(CURRENT_TERMS_VERSION);
  });
});
