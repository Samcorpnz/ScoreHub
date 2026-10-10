import { describe, it, expect } from "vitest";
import { scrubTokens } from "../sentryScrub";

describe("scrubTokens", () => {
  it("filters the token from the page URL, query string and referer", () => {
    const event = scrubTokens({
      request: {
        url: "https://app.scorehub.co.nz/display/fullscreen?matchId=m1&token=s3cret",
        query_string: "token=s3cret&matchId=m1",
        headers: { Referer: "https://app.scorehub.co.nz/reset-password?token=s3cret#top" },
      },
    });
    expect(event.request.url).toBe("https://app.scorehub.co.nz/display/fullscreen?matchId=m1&token=[Filtered]");
    expect(event.request.query_string).toBe("token=[Filtered]&matchId=m1");
    expect(event.request.headers.Referer).toBe("https://app.scorehub.co.nz/reset-password?token=[Filtered]#top");
  });

  it("filters span descriptions, span data and breadcrumbs", () => {
    const event = scrubTokens({
      spans: [{
        description: "GET https://relay.scorehub.co.nz/state?matchId=m1&token=s3cret",
        data: { "url.full": "https://relay.scorehub.co.nz/state?matchId=m1&token=s3cret", "url.query": "matchId=m1&token=s3cret" },
      }],
      breadcrumbs: [{ category: "navigation", data: { from: "/invite/accept?token=s3cret", to: "/login" } }],
    });
    expect(JSON.stringify(event)).not.toContain("s3cret");
    expect(event.spans[0].data["url.query"]).toBe("matchId=m1&token=[Filtered]");
    expect(event.breadcrumbs[0].data.to).toBe("/login");
  });

  it("leaves other parameters and non-string values alone", () => {
    const event = scrubTokens({
      request: { url: "https://app.scorehub.co.nz/control?matchId=m1&displayToken=keep" },
      timestamp: 1728000000,
      tags: null,
    });
    expect(event.request.url).toBe("https://app.scorehub.co.nz/control?matchId=m1&displayToken=keep");
    expect(event.timestamp).toBe(1728000000);
    expect(event.tags).toBeNull();
  });

  it("survives a circular reference", () => {
    const event: Record<string, unknown> = { url: "/verify-email?token=s3cret" };
    event.self = event;
    expect(scrubTokens(event).url).toBe("/verify-email?token=[Filtered]");
  });
});
