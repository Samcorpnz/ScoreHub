// storage.ts reads its R2_* env vars at import time, so each scenario loads a
// fresh copy of the module via jest.isolateModules with the S3 client mocked.

const sendMock = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: jest.fn().mockImplementation(input => ({ kind: "put", input })),
  ListObjectsV2Command: jest.fn().mockImplementation(input => ({ kind: "list", input })),
  DeleteObjectsCommand: jest.fn().mockImplementation(input => ({ kind: "delete", input })),
}));

const R2_VARS = ["R2_BUCKET", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  sendMock.mockReset();
  for (const k of R2_VARS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of R2_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setAllVars() {
  process.env.R2_BUCKET = "bucket";
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_ACCESS_KEY_ID = "key";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_PUBLIC_URL = "https://cdn.example.com/";
}

function load(): typeof import("../storage") {
  let mod!: typeof import("../storage");
  jest.isolateModules(() => { mod = require("../storage"); });
  return mod;
}

describe("storage — disabled", () => {
  it("is disabled when no R2 env vars are set", () => {
    for (const k of R2_VARS) delete process.env[k];
    expect(load().r2Enabled).toBe(false);
  });

  it.each(R2_VARS)("is disabled when only %s is missing", missing => {
    setAllVars();
    delete process.env[missing];
    expect(load().r2Enabled).toBe(false);
  });
});

describe("storage — enabled", () => {
  beforeEach(setAllVars);

  it("is enabled when every R2 var is set", () => {
    expect(load().r2Enabled).toBe(true);
  });

  it("putObject uploads and returns the public URL without a doubled slash", async () => {
    sendMock.mockResolvedValue({});
    const url = await load().putObject("orgs/o1/logo.png", Buffer.from("x"), "image/png");
    expect(url).toBe("https://cdn.example.com/orgs/o1/logo.png");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      kind: "put",
      input: { Bucket: "bucket", Key: "orgs/o1/logo.png", ContentType: "image/png" },
    });
  });

  it("putObject surfaces upload failures", async () => {
    sendMock.mockRejectedValue(new Error("r2 down"));
    await expect(load().putObject("k", Buffer.alloc(1), "image/png")).rejects.toThrow("r2 down");
  });

  it("deleteByPrefix lists then deletes every matching key", async () => {
    sendMock
      .mockResolvedValueOnce({ Contents: [{ Key: "a/logo.png" }, { Key: "a/logo.svg" }, {}] })
      .mockResolvedValueOnce({});
    await load().deleteByPrefix("a/logo");
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0][0]).toMatchObject({ kind: "list", input: { Bucket: "bucket", Prefix: "a/logo" } });
    expect(sendMock.mock.calls[1][0]).toMatchObject({
      kind: "delete",
      input: { Bucket: "bucket", Delete: { Objects: [{ Key: "a/logo.png" }, { Key: "a/logo.svg" }] } },
    });
  });

  it("deleteByPrefix skips the delete call when nothing matches", async () => {
    sendMock.mockResolvedValueOnce({ Contents: [] });
    await load().deleteByPrefix("none");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("deleteByPrefix tolerates a listing with no Contents field", async () => {
    sendMock.mockResolvedValueOnce({});
    await load().deleteByPrefix("none");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
