import { safeSegment, imageMagicBytesMatch, sanitizeSvgBuffer, validateImageUpload, UploadValidationError } from "../uploads";

const PNG  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF  = Buffer.from("GIF89a", "ascii");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);

describe("safeSegment", () => {
  it.each(["abc", "cl9x_Z-1", "A1"])("accepts %s", v => {
    expect(safeSegment(v)).toBe(v);
  });

  it.each(["", "../etc", "a/b", "a\\b", "..", "a.b", "a b", "%2e%2e", "a\0b"])("rejects %j", v => {
    expect(safeSegment(v)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(safeSegment(undefined)).toBeNull();
    expect(safeSegment(null)).toBeNull();
  });
});

describe("imageMagicBytesMatch", () => {
  it("matches each supported format against its own signature", () => {
    expect(imageMagicBytesMatch(PNG, "image/png")).toBe(true);
    expect(imageMagicBytesMatch(JPEG, "image/jpeg")).toBe(true);
    expect(imageMagicBytesMatch(GIF, "image/gif")).toBe(true);
    expect(imageMagicBytesMatch(WEBP, "image/webp")).toBe(true);
  });

  it("rejects a signature that belongs to a different format", () => {
    expect(imageMagicBytesMatch(JPEG, "image/png")).toBe(false);
    expect(imageMagicBytesMatch(PNG, "image/gif")).toBe(false);
    expect(imageMagicBytesMatch(GIF, "image/webp")).toBe(false);
  });

  it("rejects truncated buffers and unknown mime types", () => {
    expect(imageMagicBytesMatch(Buffer.from([0x89]), "image/png")).toBe(false);
    expect(imageMagicBytesMatch(Buffer.alloc(0), "image/jpeg")).toBe(false);
    expect(imageMagicBytesMatch(Buffer.from("RIFF"), "image/webp")).toBe(false);
    expect(imageMagicBytesMatch(PNG, "application/pdf")).toBe(false);
  });

  it("rejects RIFF containers that are not WEBP", () => {
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE")]);
    expect(imageMagicBytesMatch(wav, "image/webp")).toBe(false);
  });
});

describe("sanitizeSvgBuffer", () => {
  it("strips script tags and inline event handlers but keeps the drawing", () => {
    const dirty = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle cx="5" cy="5" r="4" onclick="alert(3)"/></svg>`
    );
    const clean = sanitizeSvgBuffer(dirty).toString("utf8");
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onload|onclick/i);
    expect(clean).toMatch(/<circle/);
  });

  it("removes foreignObject content", () => {
    const dirty = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>`
    );
    expect(sanitizeSvgBuffer(dirty).toString("utf8")).not.toMatch(/iframe/i);
  });
});

describe("validateImageUpload", () => {
  it("returns a matching raster upload unchanged", () => {
    expect(validateImageUpload("image/png", PNG)).toBe(PNG);
  });

  it("throws UploadValidationError when content does not match the declared type", () => {
    expect(() => validateImageUpload("image/png", JPEG)).toThrow(UploadValidationError);
    expect(() => validateImageUpload("image/jpeg", Buffer.from("<html>"))).toThrow(/does not match/);
  });

  it("sanitizes SVG uploads instead of signature-checking them", () => {
    const out = validateImageUpload("image/svg+xml", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>`));
    expect(out.toString("utf8")).not.toMatch(/<script/i);
  });
});
