import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import RootLayout, { metadata } from "../layout";

afterEach(cleanup);

describe("RootLayout", () => {
  it("exports app metadata used for the browser tab / PWA manifest", () => {
    expect(metadata.title).toBe("ScoreHub");
    expect(metadata.manifest).toBe("/manifest.json");
    expect(metadata.appleWebApp).toMatchObject({ capable: true, title: "Samcorp ScoreHub" });
  });

  it("renders its children wrapped by the html/body shell", () => {
    render(
      <RootLayout>
        <div data-testid="child">hello</div>
      </RootLayout>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByTestId("child")).toHaveTextContent("hello");
  });

  it("sets the document <html> lang attribute to en", () => {
    render(
      <RootLayout>
        <div>content</div>
      </RootLayout>
    );
    expect(document.querySelector("html")?.getAttribute("lang")).toBe("en");
  });
});
