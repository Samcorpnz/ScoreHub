export {};

const initMock = jest.fn();
const captureExceptionMock = jest.fn();

jest.mock("@sentry/node", () => ({
  init: (...a: unknown[]) => initMock(...a),
  captureException: (...a: unknown[]) => captureExceptionMock(...a),
}));

describe("sentry", () => {
  const originalDsn = process.env.SENTRY_DSN;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSentryEnv = process.env.SENTRY_ENVIRONMENT;

  beforeEach(() => {
    jest.resetModules();
    initMock.mockReset();
    captureExceptionMock.mockReset();
  });

  afterAll(() => {
    if (originalDsn) process.env.SENTRY_DSN = originalDsn;
    else delete process.env.SENTRY_DSN;
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSentryEnv) process.env.SENTRY_ENVIRONMENT = originalSentryEnv;
    else delete process.env.SENTRY_ENVIRONMENT;
  });

  it("does not initialize Sentry when SENTRY_DSN is unset", async () => {
    delete process.env.SENTRY_DSN;
    const { initSentry } = await import("../sentry");
    initSentry();
    expect(initMock).not.toHaveBeenCalled();
  });

  it("initializes Sentry with the DSN and environment when set", async () => {
    process.env.SENTRY_DSN = "https://example.invalid/1";
    process.env.NODE_ENV = "production";
    const { initSentry, scrubTokens } = await import("../sentry");
    initSentry();
    expect(initMock).toHaveBeenCalledWith({
      dsn: "https://example.invalid/1",
      environment: "production",
      tracesSampleRate: 0.1,
      beforeSend: scrubTokens,
      beforeSendTransaction: scrubTokens,
    });
  });

  it("filters the display token out of an event's URLs", async () => {
    const { scrubTokens } = await import("../sentry");
    const event = scrubTokens({
      request: { url: "https://relay.scorehub.co.nz/state?matchId=m1&token=s3cret", query_string: "matchId=m1&token=s3cret" },
      spans: [{ data: { "url.full": "https://relay.scorehub.co.nz/state?token=s3cret&matchId=m1" } }],
    });
    expect(JSON.stringify(event)).not.toContain("s3cret");
    expect(event.request.url).toBe("https://relay.scorehub.co.nz/state?matchId=m1&token=[Filtered]");
    expect(event.spans[0].data["url.full"]).toBe("https://relay.scorehub.co.nz/state?token=[Filtered]&matchId=m1");
  });

  it("SENTRY_ENVIRONMENT overrides NODE_ENV when both are set", async () => {
    process.env.SENTRY_DSN = "https://example.invalid/1";
    process.env.NODE_ENV = "production";
    process.env.SENTRY_ENVIRONMENT = "uat";
    const { initSentry } = await import("../sentry");
    initSentry();
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "uat" }),
    );
    delete process.env.SENTRY_ENVIRONMENT;
  });

  it("defaults environment to 'development' when NODE_ENV is unset", async () => {
    process.env.SENTRY_DSN = "https://example.invalid/1";
    delete process.env.NODE_ENV;
    const { initSentry } = await import("../sentry");
    initSentry();
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "development" }),
    );
  });

  it("captureException is a no-op before initSentry has run", async () => {
    process.env.SENTRY_DSN = "https://example.invalid/1";
    const { captureException } = await import("../sentry");
    captureException(new Error("boom"));
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("captureException forwards to Sentry once initialized, with extra context", async () => {
    process.env.SENTRY_DSN = "https://example.invalid/1";
    const { initSentry, captureException } = await import("../sentry");
    initSentry();

    const err = new Error("boom");
    captureException(err, { orgId: "org-1" });
    expect(captureExceptionMock).toHaveBeenCalledWith(err, { extra: { orgId: "org-1" } });
  });

  it("captureException omits the extra wrapper when no context is given", async () => {
    process.env.SENTRY_DSN = "https://example.invalid/1";
    const { initSentry, captureException } = await import("../sentry");
    initSentry();

    const err = new Error("boom");
    captureException(err);
    expect(captureExceptionMock).toHaveBeenCalledWith(err, undefined);
  });
});
