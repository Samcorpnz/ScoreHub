// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GET } from "../route";

describe("GET /api/health", () => {
  it("returns 200 { status: 'ok' } with no auth and no downstream dependencies", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
