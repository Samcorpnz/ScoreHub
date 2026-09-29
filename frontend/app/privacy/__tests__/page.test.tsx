import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import PrivacyPage from "../page";

afterEach(cleanup);

describe("/privacy", () => {
  it("renders the privacy policy heading and last-updated date", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Privacy Policy");
    expect(document.body.textContent).toMatch(/Last updated:\s*\d{1,2} \w+ \d{4}/);
  });

  it("names the operating entity and references the Privacy Act 2020", () => {
    render(<PrivacyPage />);
    expect(document.body.textContent).toContain("Samcorp Limited");
    expect(document.body.textContent).toContain("Privacy Act 2020");
  });

  it("has an anchored section for each numbered heading", () => {
    const { container } = render(<PrivacyPage />);
    const sections = container.querySelectorAll("section[id]");
    expect(sections.length).toBeGreaterThan(3);
    for (const s of sections) expect(s.querySelector("h2")).not.toBeNull();
  });
});
