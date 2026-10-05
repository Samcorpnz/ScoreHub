import { describe, it, expect } from "vitest";
import { loginRedirectUrl, postLoginDestination } from "../authRedirect";

describe("loginRedirectUrl (SA-4 control-panel server-side auth gate)", () => {
  it("returns null (no redirect) when a session with a user is present", () => {
    const req = {
      auth: { user: { id: "u1" } },
      nextUrl: new URL("http://localhost:3000/control"),
    };
    expect(loginRedirectUrl(req)).toBeNull();
  });

  it("redirects to /login with a callbackUrl when there is no session", () => {
    const req = {
      auth: null,
      nextUrl: new URL("http://localhost:3000/control/mobile"),
    };
    const url = loginRedirectUrl(req);
    expect(url).not.toBeNull();
    expect(url!.pathname).toBe("/login");
    expect(url!.searchParams.get("callbackUrl")).toBe("/control/mobile");
  });

  it("redirects when auth exists but has no user (e.g. a malformed/expired token)", () => {
    const req = {
      auth: {},
      nextUrl: new URL("http://localhost:3000/control"),
    };
    expect(loginRedirectUrl(req)).not.toBeNull();
  });
});

describe("postLoginDestination", () => {
  const APP = "https://app.scorehub.co.nz";

  it("defaults to the dashboard", () => {
    expect(postLoginDestination(null, APP)).toEqual({ url: "/dashboard", external: false });
  });

  it("keeps a same-app path, including its query string", () => {
    expect(postLoginDestination("/control/mobile?match=m1", APP)).toEqual({
      url: "/control/mobile?match=m1",
      external: false,
    });
  });

  it("returns to the paired help centre as a full navigation", () => {
    expect(postLoginDestination("https://help.scorehub.co.nz/support?contact=1", APP)).toEqual({
      url: "https://help.scorehub.co.nz/support?contact=1",
      external: true,
    });
    expect(
      postLoginDestination("https://help.uat.scorehub.co.nz/?contact=1", "https://app.uat.scorehub.co.nz").external,
    ).toBe(true);
  });

  it("normalises an in-app destination to a path, even when given as a full URL", () => {
    expect(postLoginDestination("https://app.scorehub.co.nz/account?tab=billing#plan", APP)).toEqual({
      url: "/account?tab=billing#plan",
      external: false,
    });
    // Junk that isn't a URL resolves to a harmless in-app path, never off-site.
    expect(postLoginDestination("not a url", APP)).toEqual({ url: "/not%20a%20url", external: false });
    expect(postLoginDestination("https:evil.example", APP)).toEqual({ url: "/evil.example", external: false });
  });

  it("refuses every other destination, so callbackUrl can't be used as an open redirect", () => {
    for (const hostile of [
      "https://evil.example/phish",
      "//evil.example",
      "/\\evil.example",
      "https://help.scorehub.co.nz.evil.example/",
      "https://help.uat.scorehub.co.nz/", // UAT's help site is not production's pair
      "http://help.scorehub.co.nz/", // not https
      "javascript:alert(1)",
      "/\t/evil.example", // browsers strip tabs and newlines: really //evil.example
      "/\n/evil.example",
      "\t//evil.example",
      "/\\/evil.example",
      "https://app.scorehub.co.nz@evil.example/",
    ]) {
      expect(postLoginDestination(hostile, APP)).toEqual({ url: "/dashboard", external: false });
    }
  });
});
