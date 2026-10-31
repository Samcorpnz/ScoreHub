import { describe, it, expect } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { hashLinkToken, invalidLinkResponse, isLinkUsable, readLinkSubmission, tokenFromQuery } from "../linkToken";

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("hashLinkToken", () => {
  it("is the hex SHA-256 of the token", () => {
    expect(hashLinkToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("isLinkUsable", () => {
  const future = new Date(Date.now() + 60_000);
  it("accepts an unused, unexpired row", () => {
    expect(isLinkUsable({ consumedAt: null, expiresAt: future })).toBe(true);
  });
  it("rejects a missing, consumed or expired row", () => {
    expect(isLinkUsable(null)).toBe(false);
    expect(isLinkUsable({ consumedAt: new Date(), expiresAt: future })).toBe(false);
    expect(isLinkUsable({ consumedAt: null, expiresAt: new Date(Date.now() - 1) })).toBe(false);
  });
});

describe("invalidLinkResponse", () => {
  it("names the kind of link", async () => {
    const res = invalidLinkResponse("reset");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "this reset link is invalid or has expired" });
  });
});

describe("tokenFromQuery", () => {
  it("returns the token", () => {
    expect(tokenFromQuery(new NextRequest("http://localhost/api/x?token=t1"))).toBe("t1");
  });
  it("400s without one", async () => {
    const res = tokenFromQuery(new NextRequest("http://localhost/api/x"));
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(400);
  });
});

describe("readLinkSubmission", () => {
  it("returns a valid token and password", async () => {
    expect(await readLinkSubmission(post({ token: "t", password: "12345678" }))).toEqual({ token: "t", password: "12345678" });
  });
  it("400s on a missing token, a short password or a bad body", async () => {
    for (const req of [post({ password: "12345678" }), post({ token: "t", password: "short" }), post("not json")]) {
      const res = await readLinkSubmission(req);
      expect(res).toBeInstanceOf(NextResponse);
      expect((res as NextResponse).status).toBe(400);
    }
  });
  it("says which rule failed", async () => {
    const res = (await readLinkSubmission(post({ token: "t", password: 12345678 }))) as NextResponse;
    expect(await res.json()).toEqual({ error: "password must be at least 8 characters" });
  });
});
