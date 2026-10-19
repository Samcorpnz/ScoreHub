import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useChromaKey, CHROMA_KEY_COLORS } from "../useChromaKey";

function setSearch(search: string) {
  window.history.replaceState(null, "", `/display/overlay${search}`);
}

describe("useChromaKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setSearch("");
  });

  it("stays transparent without ?key=", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setSearch("?org=org-1");
    const { result } = renderHook(() => useChromaKey());
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the key colour once the org is confirmed on the add-on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ entitled: true }) })));
    setSearch("?org=org-1&key=blue");
    const { result } = renderHook(() => useChromaKey());
    await waitFor(() => expect(result.current).toBe(CHROMA_KEY_COLORS.blue));
  });

  it("stays transparent for an org without the add-on", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ entitled: false }) }));
    vi.stubGlobal("fetch", fetchMock);
    setSearch("?org=org-1&key=green");
    const { result } = renderHook(() => useChromaKey());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
