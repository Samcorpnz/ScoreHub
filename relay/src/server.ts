import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { Server, Socket } from "socket.io";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { createAdapter } from "@socket.io/redis-adapter";
import { MatchState, DEFAULT_MATCH_STATE, IndoorCricketState } from "./types";
import { getMatchStore, allActiveStores, evictMatchStore, createLiveMatch, MatchNotFoundError } from "./persistence";
import { prisma } from "@scorehub/db";
import { verifyBridgeSecret, verifyControlSecret, verifyActionSecret, verifyGraphicsSecret, verifyDataFeedSecret, LEGACY_ROOM_ID } from "./auth";
import { getRedisClients, acquireTickLock, closeRedis, publishStateUpdate, subscribeStateUpdates } from "./redis";
import { requirePlan, requireAddOn, ConcurrentMatchLimitError, orgHasAddOn } from "./entitlements";
import { r2Enabled, putObject, deleteByPrefix } from "./storage";
import { safeSegment, validateImageUpload, UploadValidationError } from "./uploads";
import {
  matchStatePatchSchema, matchStateSchema, manualUpdateRequestSchema,
  cricketBallEventSchema, cricketOverCompleteEventSchema, cricketInningsChangeEventSchema, cricketDeclareEventSchema,
  scoreAdjustEventSchema, indoorCricketWicketEventSchema,
  graphicsSceneSchema, GraphicsScenePayload,
} from "./schemas";
import { applyCricketBall, applyOverComplete, applyInningsChange, applyDeclare } from "./cricket";
import { resyncClock } from "./clock";
import { captureException } from "./sentry";
import { logger } from "./logger";

export interface ServerOptions {
  bridgeSecret?: string;
  controlSecret?: string;
  graphicsSecret?: string;
  dataFeedSecret?: string;
  displayTokenRequired?: boolean;
  uploadDir?: string;
  allowedOrigins?: string | string[];
  controlRateLimit?: number;
  controllerTokenTtlMs?: number;
}

// Constant-time secret/token compare — same approach as auth.ts's
// secretsEqual, duplicated here (not imported) because it's used against a
// plaintext Match.displayToken column, not a hashed ScopedToken lookup.
function tokensEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// BRIDGE_SECRET/CONTROL_SECRET are the legacy plain-secret auth path, only
// ever consulted by verifyBridgeSecret/verifyControlSecret (auth.ts) when
// DATABASE_URL is unset — once it's set, those functions branch to
// ScopedToken/JWT verification and never read these values. Requiring them
// unconditionally would refuse to start any real (DATABASE_URL-backed)
// deployment that hasn't also set these otherwise-unused legacy secrets.
function requireSecret(name: "BRIDGE_SECRET" | "CONTROL_SECRET", value: string | undefined): string {
  if (!value) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        `${name} must be set — refusing to start with a default/missing secret. See relay/.env.example.`
      );
    }
    return "";
  }
  return value;
}

// No wildcard fallback — an unset/empty value denies all cross-origin
// requests rather than defaulting to "*", which would let any site read
// control-panel/control-secret-gated responses (SA code-scanning #14).
function requireAllowedOrigins(value: string | string[] | undefined): string[] {
  let list: string[];
  if (Array.isArray(value)) {
    list = value;
  } else if (value) {
    list = [value];
  } else {
    list = [];
  }
  if (list.length === 0 || list.includes("*")) {
    throw new Error(
      "ALLOWED_ORIGINS must be set to one or more explicit origins (comma-separated) — refusing to start with a wildcard/missing CORS origin. See relay/.env.example."
    );
  }
  return list;
}

// Per-(org, match) in-memory state and the active bridge connection for
// that room. This is what makes match state genuinely tenant-scoped: one
// relay process can serve many orgs (and many matches per org), each
// isolated to its own Socket.io room. Omitting matchId addresses the
// org's singleton "default" room — unchanged from before multi-match
// support existed, so bridges/displays/old links never had to change.
function roomFor(orgId: string, matchId?: string): string {
  return matchId ? `match:${matchId}` : orgId;
}

// See the Match.displayToken schema comment and DISPLAY_TOKEN_REQUIRED above
// for the rollout story. `displayToken` is null when the match predates the
// backfill migration (packages/db/scripts/backfill-display-tokens.ts) — treat
// that as "not enforceable yet" regardless of the flag, same as a caller
// supplying no matchId at all (org-singleton links have nothing to check a
// token against).
export function isDisplayTokenValid(displayToken: string | null | undefined, token: string | undefined, required: boolean): boolean {
  if (!displayToken) return true;
  if (token) return tokensEqual(token, displayToken);
  return !required;
}

export function createServer(options: ServerOptions = {}) {
  const BRIDGE_SECRET  = requireSecret("BRIDGE_SECRET", options.bridgeSecret || process.env.BRIDGE_SECRET);
  const CONTROL_SECRET = requireSecret("CONTROL_SECRET", options.controlSecret || process.env.CONTROL_SECRET);
  // Unlike BRIDGE_SECRET/CONTROL_SECRET, not startup-mandatory: the Graphics
  // Operator add-on is opt-in, and requiring this would break every existing
  // deployment/test that predates it. Left unset (""), legacy-mode graphics
  // auth simply always fails closed — the add-on isn't usable until an
  // operator explicitly configures it, which is the correct default.
  const GRAPHICS_SECRET = options.graphicsSecret || process.env.GRAPHICS_SECRET || "";
  // Same non-mandatory reasoning as GRAPHICS_SECRET above — the Data Feed
  // add-on is opt-in, left unset means legacy-mode data-feed auth always
  // fails closed until an operator configures it.
  const DATA_FEED_SECRET = options.dataFeedSecret || process.env.DATA_FEED_SECRET || "";
  // Display-URL lockdown rollout flag (see the Match.displayToken column
  // comment in packages/db/prisma/schema.prisma) — false/unset validates a
  // token IF one is present but still allows requests with none at all, so
  // this can ship well before enforcement actually flips on. Flip once
  // existing /display/* links have had time to be regenerated with a token.
  const DISPLAY_TOKEN_REQUIRED = options.displayTokenRequired ?? (process.env.DISPLAY_TOKEN_REQUIRED === "true");
  const UPLOAD_DIR     = options.uploadDir     ?? process.env.UPLOAD_DIR     ?? path.join(process.cwd(), "uploads");
  const ALLOWED_ORIGINS: string[] = requireAllowedOrigins(
    options.allowedOrigins ?? process.env.ALLOWED_ORIGINS?.split(",").map(o => o.trim())
  );

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const app = express();
  // Railway (and most PaaS hosts) sit in front as a reverse proxy and set
  // X-Forwarded-For — without this, express-rate-limit can't trust that
  // header and falls back to misidentifying every request as coming from
  // the same IP, defeating the per-IP brute-force limits on controlAuth
  // routes. `1` trusts exactly one hop (the platform's own proxy).
  app.set("trust proxy", 1);
  app.use(cors({ origin: ALLOWED_ORIGINS }));
  app.use(express.json());
  // nosniff on all served uploads; SVGs (which can carry markup) get a
  // locked-down CSP as belt-and-braces alongside upload-time sanitization.
  const uploadStaticHeaders = (res: express.Response, filePath: string): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (filePath.toLowerCase().endsWith(".svg")) {
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader("Content-Disposition", "inline");
    }
  };
  app.use("/logos", express.static(UPLOAD_DIR, { setHeaders: uploadStaticHeaders }));

  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
  });

  // When REDIS_URL is set, broadcasts reach sockets connected to other relay
  // instances too — required so multiple relay processes can sit behind a
  // load balancer (SA-19). Absent REDIS_URL this is a no-op single instance.
  const redisClients = getRedisClients();
  if (redisClients) {
    io.adapter(createAdapter(redisClients.pub, redisClients.sub));
  }

  const matchStates = new Map<string, { orgId: string; matchId?: string; state: MatchState }>();
  const bridgeSockets = new Map<string, Socket>();
  const roomCounts = new Map<string, number>();
  // Undo stack: stores pre-change states for manual control panel updates only.
  // Bridge hardware updates and clock ticks are NOT undo-able.
  const undoStacks = new Map<string, MatchState[]>();
  const UNDO_STACK_SIZE = 50;
  // Controller mutex: only one control panel may send scoring events per match.
  // key = room, value = socket.id (+ owning user, when known) of the active controller.
  // Token expires after TTL on ungraceful disconnect to allow page refresh.
  const controllerTokens = new Map<string, { socketId: string; expiresAt: number; userId?: string }>();
  const CONTROLLER_TOKEN_TTL_MS = options.controllerTokenTtlMs ?? 30_000;
  // Graphics Operator add-on: which scene is currently live per room.
  // In-memory only for Phase A (like controllerTokens/undoStacks above) — a
  // relay restart resets to no active scene, same as those. No mutex: last
  // write wins, matching matchStateChange's own concurrency model.
  const sceneStates = new Map<string, GraphicsScenePayload & { updatedAt: string }>();

  async function getState(orgId: string, matchId?: string): Promise<MatchState> {
    const room = roomFor(orgId, matchId);
    const cached = matchStates.get(room);
    if (cached) return cached.state;
    const store = getMatchStore(orgId, matchId);
    const state = store ? await store.load() : { ...DEFAULT_MATCH_STATE };
    matchStates.set(room, { orgId, matchId, state });
    return state;
  }

  function setState(orgId: string, next: MatchState, matchId?: string): void {
    const room = roomFor(orgId, matchId);
    matchStates.set(room, { orgId, matchId, state: next });
    io.to(room).emit("matchStateChange", next);
    getMatchStore(orgId, matchId)?.save(next);
    publishStateUpdate(room, next);
  }

  // Keeps this instance's cache fresh for rooms being written to on a *different*
  // relay instance, so a client that (re)connects here after a failover doesn't
  // get served a snapshot from before the other instance's most recent writes.
  // Ignores out-of-order messages via the same sequenceId guard used for
  // bridge-originated updates. Only updates rooms this instance already has
  // cached — a room with no local entry has no locally-connected clients, so
  // getState() will load it fresh from the store on demand instead.
  subscribeStateUpdates((room, raw) => {
    const parsed = matchStateSchema.safeParse(raw);
    if (!parsed.success) return;
    const incoming = parsed.data as MatchState;
    const current = matchStates.get(room);
    if (current && incoming.sequenceId >= current.state.sequenceId) {
      matchStates.set(room, { ...current, state: incoming });
    }
  });

  // Bound on how far a client-supplied clock-event timestamp (see
  // applyManualUpdate's eventMs param) may diverge from the relay's own
  // receive time before it's distrusted and receive-time is used instead.
  // Bounds clock-skew-estimation error and protects against a stale/bad value.
  const MAX_CLOCK_EVENT_SKEW_MS = 2000;

  async function applyManualUpdate(
    orgId: string,
    patch: Partial<MatchState>,
    matchId?: string,
    eventMs?: number,
  ): Promise<MatchState> {
    const current = await getState(orgId, matchId);
    // Capture pre-change state for undo before overwriting
    const room = roomFor(orgId, matchId);
    const stack = undoStacks.get(room) ?? [];
    stack.push(current);
    if (stack.length > UNDO_STACK_SIZE) stack.shift();
    undoStacks.set(room, stack);

    const now = Date.now();
    const effectiveMs =
      eventMs !== undefined && Math.abs(eventMs - now) <= MAX_CLOCK_EVENT_SKEW_MS ? eventMs : now;

    // Relay-tick-loop clock precision: anchor on start, precisely resync
    // (folding real elapsed time into clockSeconds + clockCarryMs, discarding
    // nothing) on stop, using the caller's latency-compensated click instant
    // when trustworthy. Only applies when the patch is a plain isRunning
    // transition — if the caller is also overriding clockSeconds outright
    // (e.g. /action/period/end), that override wins and the anchor/carry
    // are just cleared for the fresh value.
    let clockPatch: Partial<MatchState> = {};
    if (patch.isRunning === true && !current.isRunning) {
      clockPatch = { clockAnchorMs: effectiveMs };
    } else if (patch.isRunning === false && current.isRunning) {
      if (patch.clockSeconds === undefined) {
        const resynced = resyncClock(current, effectiveMs);
        clockPatch = {
          clockSeconds: resynced.clockSeconds,
          clockCarryMs: resynced.clockCarryMs,
          clockAnchorMs: undefined,
        };
      } else {
        clockPatch = { clockAnchorMs: undefined, clockCarryMs: 0 };
      }
    }

    const next: MatchState = {
      ...current,
      ...patch,
      ...clockPatch,
      // Starting the clock always exits break state
      ...(patch.isRunning === true ? { periodBreak: false } : {}),
      sequenceId: current.sequenceId + 1,
      inputSource: patch.inputSource ?? "manual",
      home:    { ...current.home,    ...patch.home },
      visitor: { ...current.visitor, ...patch.visitor },
    };
    setState(orgId, next, matchId);
    return next;
  }

  // Tick the clock every second for every loaded org that's running and
  // not currently being driven by a connected bridge. acquireTickLock
  // ensures only one relay instance advances a given org's clock when
  // multiple instances share Redis (SA-19) — it's a no-op true when Redis
  // is unset, so single-instance behavior is unchanged.
  //
  // Uses resyncClock (anchor + carried sub-second remainder) rather than a
  // blind ±1 per firing, so the clock is exact regardless of setInterval
  // jitter and no fractional second is ever discarded on stop (see clock.ts).
  const clockInterval = setInterval(() => {
    for (const [room, entry] of matchStates) {
      const { orgId, matchId, state } = entry;
      if (!state.isRunning || bridgeSockets.get(room)?.connected) continue;
      acquireTickLock(room)
        .then(acquired => {
          if (!acquired) return;
          const resynced = resyncClock(state, Date.now());
          setState(orgId, { ...state, ...resynced, sequenceId: state.sequenceId + 1 }, matchId);
        })
        .catch(err => console.error("[relay] failed to acquire tick lock for room", room, err));
    }
  }, 1000);

  // ─── Logo upload ─────────────────────────────────────────────────────────────
  // Local-disk paths and R2 object keys are both scoped under the requesting
  // org's id (set by controlAuth, which runs before multer in the middleware
  // chain) — logos/sounds are per-tenant, so a flat shared directory/bucket
  // prefix would leak one org's branding into every other org's display.

  // All image uploads use memory storage so the handler can validate/sanitize
  // the bytes (validateImageUpload) before persisting, and so filenames/keys
  // are built from sanitized values rather than raw request params.
  const imageFileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif"];
    cb(null, allowed.includes(file.mimetype));
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter,
  });

  // Persist a validated image buffer under an org-scoped path, returning the
  // public URL (relative for local disk, absolute CDN url for R2). `segment`
  // is the base filename (already sanitized/validated by the caller).
  async function storeImage(
    prefix: "logos" | "player-photos",
    orgId: string,
    segment: string,
    ext: string,
    mimetype: string,
    buffer: Buffer,
  ): Promise<string> {
    const key = `${prefix}/${orgId}/${segment}${ext}`;
    if (r2Enabled) {
      return putObject(key, buffer, mimetype);
    }
    const baseDir = prefix === "logos" ? UPLOAD_DIR : PLAYER_PHOTOS_DIR;
    const dir = path.join(baseDir, orgId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${segment}${ext}`), buffer);
    return `/${prefix}/${orgId}/${segment}${ext}`;
  }

  async function controlAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): Promise<void> {
    const secret = req.headers["x-control-secret"];
    const result = await verifyControlSecret(typeof secret === "string" ? secret : undefined, CONTROL_SECRET);
    if (!result) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as any).orgId = result.orgId;
    next();
  }

  // 20 requests per IP per minute on control-secret-gated endpoints — must run
  // before controlAuth, or failed auth attempts (brute force) bypass the limit
  // entirely since the limiter would only see requests that already passed auth.
  function onRateLimited(req: express.Request, res: express.Response): void {
    logger.warn("rate_limit.tripped", { path: req.path, ip: req.ip });
    res.status(429).json({ error: "too many requests" });
  }

  const controlRateLimit = rateLimit({
    windowMs: 60_000,
    limit: options.controlRateLimit ?? 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: onRateLimited,
  });

  // Sized for legitimate 1-5Hz polling (per OutputsTab's REST snapshot docs)
  // plus headroom, not the 20/min control-secret limit above — this is a
  // read-only feed a third-party graphics engine polls continuously.
  const dataFeedRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    handler: onRateLimited,
  });

  app.post(
    "/api/logo/:team",
    controlRateLimit,
    controlAuth,
    requirePlan(["pro", "venue"]),
    upload.single("logo"),
    async (req, res) => {
      const team = req.params.team as "home" | "visitor";
      if (team !== "home" && team !== "visitor") {
        res.status(400).json({ error: "team must be 'home' or 'visitor'" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "no file uploaded" });
        return;
      }

      const orgId = (req as any).orgId as string;
      let buffer: Buffer;
      try {
        buffer = validateImageUpload(req.file.mimetype, req.file.buffer);
      } catch (err) {
        if (err instanceof UploadValidationError) { res.status(400).json({ error: err.message }); return; }
        throw err;
      }
      const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
      const storedUrl = await storeImage("logos", orgId, team, ext, req.file.mimetype, buffer);
      const logoUrl = `${storedUrl}?t=${Date.now()}`;
      const state = await getState(orgId);

      await applyManualUpdate(orgId, {
        [team]: { ...state[team], logoUrl },
      } as Partial<MatchState>);

      res.json({ logoUrl });
    }
  );

  app.delete("/api/logo/:team", controlRateLimit, controlAuth, requirePlan(["pro", "venue"]), async (req, res) => {
    const team = req.params.team as "home" | "visitor";
    if (team !== "home" && team !== "visitor") {
      res.status(400).json({ error: "team must be 'home' or 'visitor'" });
      return;
    }
    const orgId = (req as any).orgId as string;
    if (r2Enabled) {
      await deleteByPrefix(`logos/${orgId}/${team}.`);
    } else {
      const dir = path.join(UPLOAD_DIR, orgId);
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).filter(f => f.startsWith(`${team}.`)).forEach(f => fs.unlinkSync(path.join(dir, f)));
      }
    }

    const state = await getState(orgId);
    await applyManualUpdate(orgId, {
      [team]: { ...state[team], logoUrl: "" },
    } as Partial<MatchState>);

    res.json({ status: "removed" });
  });

  // ─── Competition logo upload ──────────────────────────────────────────────────

  const compUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter,
  });

  app.post("/api/competition-logo", controlRateLimit, controlAuth, requirePlan(["pro", "venue"]), compUpload.single("logo"), async (req, res) => {
    if (!req.file) { res.status(400).json({ error: "no file uploaded" }); return; }
    const orgId = (req as any).orgId as string;
    let buffer: Buffer;
    try {
      buffer = validateImageUpload(req.file.mimetype, req.file.buffer);
    } catch (err) {
      if (err instanceof UploadValidationError) { res.status(400).json({ error: err.message }); return; }
      throw err;
    }
    const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
    const storedUrl = await storeImage("logos", orgId, "competition", ext, req.file.mimetype, buffer);
    const competitionLogoUrl = `${storedUrl}?t=${Date.now()}`;
    const state = await getState(orgId);
    await applyManualUpdate(orgId, { displayTheme: { ...state.displayTheme, competitionLogoUrl } });
    res.json({ competitionLogoUrl });
  });

  app.delete("/api/competition-logo", controlRateLimit, controlAuth, requirePlan(["pro", "venue"]), async (req, res) => {
    const orgId = (req as any).orgId as string;
    if (r2Enabled) {
      await deleteByPrefix(`logos/${orgId}/competition.`);
    } else {
      const dir = path.join(UPLOAD_DIR, orgId);
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).filter(f => f.startsWith("competition.")).forEach(f => fs.unlinkSync(path.join(dir, f)));
      }
    }
    const state = await getState(orgId);
    await applyManualUpdate(orgId, { displayTheme: { ...state.displayTheme, competitionLogoUrl: "" } });
    res.json({ status: "removed" });
  });

  // ─── Player photo upload ─────────────────────────────────────────────────────
  // Graphics Operator add-on roster (Phase C): gated by requireAddOn rather
  // than requirePlan, since this is orthogonal to the pro/venue plan tiers —
  // an org needs the graphics-operator add-on, not a specific plan. The
  // uploaded photoUrl is handed back to the caller (frontend/control/roster),
  // which PATCHes it onto the Player row via the players API route — this
  // route only knows about storage, not the Player model.

  const PLAYER_PHOTOS_DIR = path.join(UPLOAD_DIR, "player-photos");
  fs.mkdirSync(PLAYER_PHOTOS_DIR, { recursive: true });
  app.use("/player-photos", express.static(PLAYER_PHOTOS_DIR, { setHeaders: uploadStaticHeaders }));

  const playerPhotoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/png", "image/jpeg", "image/webp"];
      cb(null, allowed.includes(file.mimetype));
    },
  });

  app.post(
    "/api/player-photo/:playerId",
    controlRateLimit,
    controlAuth,
    requireAddOn("graphics-operator"),
    playerPhotoUpload.single("photo"),
    async (req, res) => {
      if (!req.file) { res.status(400).json({ error: "no file uploaded" }); return; }
      const orgId = (req as any).orgId as string;
      const playerId = safeSegment(req.params.playerId);
      if (!playerId) { res.status(400).json({ error: "invalid playerId" }); return; }

      let buffer: Buffer;
      try {
        buffer = validateImageUpload(req.file.mimetype, req.file.buffer);
      } catch (err) {
        if (err instanceof UploadValidationError) { res.status(400).json({ error: err.message }); return; }
        throw err;
      }
      const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
      const storedUrl = await storeImage("player-photos", orgId, playerId, ext, req.file.mimetype, buffer);
      res.json({ photoUrl: `${storedUrl}?t=${Date.now()}` });
    }
  );

  app.delete("/api/player-photo/:playerId", controlRateLimit, controlAuth, requireAddOn("graphics-operator"), async (req, res) => {
    const orgId = (req as any).orgId as string;
    const playerId = safeSegment(req.params.playerId);
    if (!playerId) { res.status(400).json({ error: "invalid playerId" }); return; }
    if (r2Enabled) {
      await deleteByPrefix(`player-photos/${orgId}/${playerId}.`);
    } else {
      const dir = path.join(PLAYER_PHOTOS_DIR, orgId);
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).filter(f => f.startsWith(`${playerId}.`)).forEach(f => fs.unlinkSync(path.join(dir, f)));
      }
    }
    res.json({ status: "removed" });
  });

  // ─── Sound upload ────────────────────────────────────────────────────────────

  const SOUNDS_DIR = path.join(UPLOAD_DIR, "sounds");
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
  app.use("/sounds", express.static(SOUNDS_DIR, { setHeaders: uploadStaticHeaders }));

  const soundUpload = multer({
    storage: r2Enabled
      ? multer.memoryStorage()
      : multer.diskStorage({
          destination: (req, _file, cb) => {
            const dir = path.join(SOUNDS_DIR, (req as any).orgId);
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
          },
          filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase() || ".mp3";
            const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
            cb(null, `${id}${ext}`);
          },
        }),
    // Sound effects are short clips, not full tracks — 8MB is comfortably
    // above anything legitimate while keeping the request-size ceiling sane.
    limits: { fileSize: 8_000_000 },
    fileFilter: (_req, file, cb) => {
      cb(null, file.mimetype.startsWith("audio/"));
    },
  });

  app.post("/api/sound", controlRateLimit, controlAuth, requirePlan(["pro", "venue"]), soundUpload.single("sound"), async (req, res) => {
    if (!req.file) { res.status(400).json({ error: "no file uploaded" }); return; }
    const orgId = (req as any).orgId as string;

    if (r2Enabled) {
      const ext = path.extname(req.file.originalname).toLowerCase() || ".mp3";
      const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
      const url = await putObject(`sounds/${orgId}/${filename}`, req.file.buffer, req.file.mimetype);
      res.json({ filename, originalName: req.file.originalname, url });
      return;
    }

    res.json({ filename: req.file.filename, originalName: req.file.originalname, url: `/sounds/${orgId}/${req.file.filename}` });
  });

  const ALLOWED_AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".aac", ".flac", ".m4a", ".webm"]);
  app.delete("/api/sound/:filename", controlRateLimit, controlAuth, requirePlan(["pro", "venue"]), async (req, res) => {
    const filename = path.basename(String(req.params.filename));
    if (!ALLOWED_AUDIO_EXTS.has(path.extname(filename).toLowerCase())) {
      res.status(400).json({ error: "invalid file type" });
      return;
    }
    const orgId = (req as any).orgId as string;
    if (r2Enabled) {
      await deleteByPrefix(`sounds/${orgId}/${filename}`);
    } else {
      const filePath = path.join(SOUNDS_DIR, orgId, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    res.json({ status: "removed" });
  });

  // ─── REST ────────────────────────────────────────────────────────────────────

  app.get("/", (_req, res) => res.json({ status: "ok", version: "1.0.0" }));

  // Shared by every route that can trigger match creation (getState/
  // applyManualUpdate), since that's the one place a Free-tier account can
  // be blocked from bringing up a second concurrent live match.
  function respondToStateError(res: express.Response, err: unknown): void {
    if (err instanceof ConcurrentMatchLimitError) {
      res.status(402).json({ error: err.message });
      return;
    }
    console.error("[relay] failed to load/update match state:", err);
    captureException(err);
    res.status(500).json({ error: "internal error" });
  }

  // Unauthenticated liveness check for external uptime monitors (SA-29) —
  // intentionally has no dependency on Postgres/Redis so it reflects whether
  // this process is alive, not whether its backing stores are reachable.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Used by the Stream Deck plugin on startup: exchange a CONTROL token for
  // the orgId (and optional matchId) needed to open a viewer socket.
  app.get("/api/me", controlRateLimit, async (req, res) => {
    const secret = req.headers["x-control-secret"];
    const result = await verifyActionSecret(typeof secret === "string" ? secret : undefined, CONTROL_SECRET);
    if (!result) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({ orgId: result.orgId, matchId: result.matchId ?? null });
  });

  app.get("/state", async (req, res) => {
    let orgId = typeof req.query.org === "string" ? req.query.org : undefined;
    const matchId = typeof req.query.matchId === "string" ? req.query.matchId : undefined;
    const token = typeof req.query.token === "string" ? req.query.token : undefined;
    // A display link only carries matchId (org is optional sugar) — resolve
    // orgId from the match row rather than falling through to LEGACY_ROOM_ID,
    // which doesn't exist as a real org once DATABASE_URL is set and would
    // otherwise 500 trying to auto-create a match under a non-existent org.
    // Also the one place displayToken is checked — see DISPLAY_TOKEN_REQUIRED.
    if (matchId && process.env.DATABASE_URL) {
      const row = await prisma.match.findUnique({ where: { id: matchId }, select: { orgId: true, displayToken: true } });
      if (row) {
        orgId = orgId ?? row.orgId;
        if (!isDisplayTokenValid(row.displayToken, token, DISPLAY_TOKEN_REQUIRED)) {
          res.status(403).json({ error: "invalid or missing display token" });
          return;
        }
      }
    }
    if (!orgId) {
      if (process.env.DATABASE_URL) {
        res.status(400).json({ error: "org (or a valid matchId) is required" });
        return;
      }
      orgId = LEGACY_ROOM_ID;
    }
    try {
      res.json(await getState(orgId, matchId));
    } catch (err) {
      respondToStateError(res, err);
    }
  });

  // Data Feed add-on: authenticated equivalent of GET /state for third-party
  // consumers (Singular.live, VIZRT) that can't use the public/display path —
  // see verifyDataFeedSecret and POST /api/orgs/[orgId]/tokens (frontend).
  app.get("/api/data-feed/state", dataFeedRateLimit, async (req, res) => {
    const secret = req.headers["x-data-feed-secret"];
    const result = await verifyDataFeedSecret(typeof secret === "string" ? secret : undefined, DATA_FEED_SECRET);
    if (!result) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!(await orgHasAddOn(result.orgId, "data-feed"))) {
      res.status(403).json({ error: "This feature requires the data-feed add-on — upgrade at /account/billing" });
      return;
    }
    const matchId = result.matchId ?? (typeof req.query.matchId === "string" ? req.query.matchId : undefined);
    try {
      res.json(await getState(result.orgId, matchId));
    } catch (err) {
      respondToStateError(res, err);
    }
  });

  // Public (no secret) — the /display/graphics Browser Source has no
  // session, so it needs a way to know whether to render the ScoreHub-logo
  // upgrade-prompt state versus the live scene tree. Only exposes a
  // boolean, same trust level as /state itself.
  app.get("/api/graphics/entitlement", async (req, res) => {
    const orgId = typeof req.query.org === "string" ? req.query.org : LEGACY_ROOM_ID;
    res.json({ entitled: await orgHasAddOn(orgId, "graphics-operator") });
  });

  // Public (no secret), same trust level as /api/graphics/entitlement above —
  // /display/graphics has no session and needs to resolve a live feed
  // player's id (provider externalId) to a roster photo/bio.
  //
  // Scoped to the specific externalId(s) the caller passes (the ids currently
  // on the live feed), NOT the whole roster: this returns PII (names, bios,
  // photo URLs), and the org id — though a cuid — is embedded in the shareable
  // display URL, so returning every player would let anyone with that link dump
  // the org's entire people database. Requiring the feed ids means a caller can
  // only retrieve players whose id they already hold, not enumerate the roster.
  // Still gated by orgHasAddOn on top of that.
  app.get("/api/graphics/roster", async (req, res) => {
    const orgId = typeof req.query.org === "string" ? req.query.org : LEGACY_ROOM_ID;
    // Accept repeated (?externalId=a&externalId=b) or comma-separated ids.
    const raw = req.query.externalId;
    const externalIds = (Array.isArray(raw) ? raw : [raw])
      .flatMap(v => (typeof v === "string" ? v.split(",") : []))
      .map(s => s.trim())
      .filter(Boolean);
    if (!process.env.DATABASE_URL || externalIds.length === 0) {
      res.json({ players: [] });
      return;
    }
    if (!(await orgHasAddOn(orgId, "graphics-operator"))) {
      res.json({ players: [] });
      return;
    }
    const players = await prisma.player.findMany({
      where: { orgId, externalId: { in: externalIds } },
      select: { externalId: true, provider: true, firstName: true, lastName: true, displayName: true, photoUrl: true, bio: true },
    });
    res.json({ players });
  });

  app.post("/manual", controlRateLimit, async (req, res) => {
    const secret = req.headers["x-control-secret"];
    const result = await verifyControlSecret(typeof secret === "string" ? secret : undefined, CONTROL_SECRET);
    if (!result) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const parsed = matchStatePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid match state patch", details: parsed.error.issues });
      return;
    }
    try {
      const next = await applyManualUpdate(result.orgId, parsed.data as Partial<MatchState>, result.matchId);
      res.json(next);
    } catch (err) {
      respondToStateError(res, err);
    }
  });

  // ─── Action endpoints (Stream Deck / keyboard shortcut webhooks) ────────────
  // Atomic verbs rather than raw MatchState patches — safe to fire without
  // knowing current state. Auth: long-lived CONTROL ScopedToken via
  // x-control-secret, or a short-lived operator JWT from the control panel.
  // ?matchId= on the query string overrides the token's pinned matchId so one
  // token can drive multiple matches if it isn't pinned.

  const actionRateLimit = rateLimit({
    windowMs: 60_000,
    limit: options.controlRateLimit ?? 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: onRateLimited,
  });

  async function actionAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): Promise<void> {
    const secret = req.headers["x-control-secret"];
    const result = await verifyActionSecret(typeof secret === "string" ? secret : undefined, CONTROL_SECRET);
    if (!result) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    // ?matchId= on the request can override the token's own matchId (only if
    // the token isn't pinned to a specific match).
    const qMatchId = typeof req.query.matchId === "string" ? req.query.matchId : undefined;
    (req as any).orgId = result.orgId;
    (req as any).matchId = result.matchId ?? qMatchId;
    next();
  }

  app.post("/action/start", actionRateLimit, actionAuth, async (req, res) => {
    const orgId = (req as any).orgId as string;
    const matchId = (req as any).matchId as string | undefined;
    try {
      const next = await applyManualUpdate(orgId, { isRunning: true }, matchId);
      res.json({ ok: true, isRunning: next.isRunning });
    } catch (err) { respondToStateError(res, err); }
  });

  app.post("/action/stop", actionRateLimit, actionAuth, async (req, res) => {
    const orgId = (req as any).orgId as string;
    const matchId = (req as any).matchId as string | undefined;
    try {
      const next = await applyManualUpdate(orgId, { isRunning: false }, matchId);
      res.json({ ok: true, isRunning: next.isRunning });
    } catch (err) { respondToStateError(res, err); }
  });

  app.post("/action/toggle", actionRateLimit, actionAuth, async (req, res) => {
    const orgId = (req as any).orgId as string;
    const matchId = (req as any).matchId as string | undefined;
    try {
      const current = await getState(orgId, matchId);
      const next = await applyManualUpdate(orgId, { isRunning: !current.isRunning }, matchId);
      res.json({ ok: true, isRunning: next.isRunning });
    } catch (err) { respondToStateError(res, err); }
  });

  // POST /action/score/:team?delta=1  (team = home | visitor)
  app.post("/action/score/:team", actionRateLimit, actionAuth, async (req, res) => {
    const team = req.params.team as "home" | "visitor";
    if (team !== "home" && team !== "visitor") {
      res.status(400).json({ error: "team must be 'home' or 'visitor'" });
      return;
    }
    const delta = Number.parseInt(String(req.query.delta ?? req.body?.delta ?? "1"), 10);
    if (Number.isNaN(delta) || delta < -99 || delta > 99) {
      res.status(400).json({ error: "delta must be an integer between -99 and 99" });
      return;
    }
    const orgId = (req as any).orgId as string;
    const matchId = (req as any).matchId as string | undefined;
    try {
      const current = await getState(orgId, matchId);
      const newScore = Math.max(0, current[team].score + delta);
      const next = await applyManualUpdate(orgId, { [team]: { ...current[team], score: newScore } }, matchId);
      res.json({ ok: true, score: next[team].score });
    } catch (err) { respondToStateError(res, err); }
  });

  app.post("/action/period/next", actionRateLimit, actionAuth, async (req, res) => {
    const orgId = (req as any).orgId as string;
    const matchId = (req as any).matchId as string | undefined;
    try {
      const current = await getState(orgId, matchId);
      const n = Number.parseInt(current.period, 10);
      const next = await applyManualUpdate(orgId, { period: String(Number.isNaN(n) ? 2 : n + 1) }, matchId);
      res.json({ ok: true, period: next.period });
    } catch (err) { respondToStateError(res, err); }
  });

  app.post("/action/period/prev", actionRateLimit, actionAuth, async (req, res) => {
    const orgId = (req as any).orgId as string;
    const matchId = (req as any).matchId as string | undefined;
    try {
      const current = await getState(orgId, matchId);
      const n = Number.parseInt(current.period, 10);
      const next = await applyManualUpdate(orgId, { period: String(Number.isNaN(n) || n <= 1 ? 1 : n - 1) }, matchId);
      res.json({ ok: true, period: next.period });
    } catch (err) { respondToStateError(res, err); }
  });

  // Default clock duration per sport, mirroring sport-templates.ts in the frontend.
  const SPORT_DEFAULT_CLOCK: Record<string, number> = {
    netball: 900, basketball: 600, rugby_union: 0, rugby_league: 0,
    volleyball: 0, football: 0, handball: 1800, hockey: 900, waterpolo: 480,
    tennis: 0, touch_rugby: 2400, futsal: 1200, pickleball: 0, badminton: 0,
    table_tennis: 0, floorball: 1200, squash: 0, lawn_bowls: 0,
    indoor_cricket: 0, softball: 0, cricket: 0, custom: 600,
  };

  // Sports where scores reset to 0 when a period/set/game ends (e.g. volleyball, tennis).
  const SPORT_RESET_SCORE_ON_PERIOD = new Set<string>([
    "volleyball", "tennis",
    "pickleball", "badminton", "table_tennis", "squash",
  ]);

  app.post("/action/period/end", actionRateLimit, actionAuth, async (req, res) => {
    const orgId = (req as any).orgId as string;
    const matchId = (req as any).matchId as string | undefined;
    try {
      const current = await getState(orgId, matchId);
      const n = Number.parseInt(current.period, 10);
      const defaultClock = SPORT_DEFAULT_CLOCK[current.sport] ?? 0;
      const resetScoreOnPeriod = SPORT_RESET_SCORE_ON_PERIOD.has(current.sport);
      const next = await applyManualUpdate(orgId, {
        isRunning: false,
        clockSeconds: defaultClock,
        period: String(Number.isNaN(n) ? 2 : n + 1),
        periodBreak: true,
        ...(resetScoreOnPeriod && {
          home: { ...current.home, score: 0 },
          visitor: { ...current.visitor, score: 0 },
        }),
      }, matchId);
      res.json({ ok: true, period: next.period, clockSeconds: next.clockSeconds });
    } catch (err) { respondToStateError(res, err); }
  });

  // Always creates a brand-new LIVE match (entitlement-gated), used by
  // /setup's "Start Match" so every ad-hoc match gets its own id rather than
  // silently reusing whatever the org's current LIVE match happens to be.
  app.post("/match", controlRateLimit, async (req, res) => {
    const secret = req.headers["x-control-secret"];
    const result = await verifyControlSecret(typeof secret === "string" ? secret : undefined, CONTROL_SECRET);
    if (!result) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!process.env.DATABASE_URL) {
      res.status(501).json({ error: "match creation requires multi-tenant mode (DATABASE_URL)" });
      return;
    }
    try {
      const id = await createLiveMatch(result.orgId);
      res.json({ id });
    } catch (err) {
      respondToStateError(res, err);
    }
  });

  // ─── Socket.io ───────────────────────────────────────────────────────────────

  io.use(async (socket, next) => {
    const { secret, role, orgId: requestedOrgId, matchId: requestedMatchId, token: requestedToken } = socket.handshake.auth as {
      secret?: string;
      role?: string;
      orgId?: string;
      matchId?: string;
      token?: string;
    };

    let orgId: string | null = null;
    let matchId: string | undefined;

    if (role === "bridge") {
      const result = await verifyBridgeSecret(secret, BRIDGE_SECRET);
      if (result) {
        orgId = result.orgId;
        matchId = result.matchId;
        (socket as any).isBridge = true;
      }
    } else if (role === "control") {
      const result = await verifyControlSecret(secret, CONTROL_SECRET);
      if (result) {
        orgId = result.orgId;
        matchId = result.matchId;
        (socket as any).isControl = true;
        (socket as any).controlUserId = result.userId;
      }
    } else if (role === "graphics") {
      const result = await verifyGraphicsSecret(secret, GRAPHICS_SECRET);
      // Entitlement check happens here, at the handshake, rather than lazily
      // in the setScene handler — fail fast, and a non-entitled connection
      // never gets isGraphics=true, so it just falls through to a normal
      // (control-mutation-less) viewer connection rather than a hard error.
      if (result && (await orgHasAddOn(result.orgId, "graphics-operator"))) {
        orgId = result.orgId;
        matchId = result.matchId;
        (socket as any).isGraphics = true;
      }
    } else if (role === "data-feed") {
      const result = await verifyDataFeedSecret(secret, DATA_FEED_SECRET);
      if (result && (await orgHasAddOn(result.orgId, "data-feed"))) {
        orgId = result.orgId;
        matchId = result.matchId;
        (socket as any).isDataFeed = true;
      }
    }

    orgId = orgId ?? requestedOrgId ?? null;

    // Viewer/display connections have no signed token — they pass orgId and
    // an optional matchId straight from the display URL's query params, so
    // matchId has to be validated against orgId here before it's trusted.
    // If orgId is absent (a display link with only ?matchId=, e.g. hand-edited
    // or from an older link format), resolve it from the match row instead of
    // falling through to LEGACY_ROOM_ID — otherwise the lookup below always
    // misses and the viewer silently joins the wrong (empty) room. This is
    // also where the displayToken is checked (see DISPLAY_TOKEN_REQUIRED) —
    // a role branch above (bridge/control/graphics/data-feed) already proved
    // itself via a signed secret, so only the unauthenticated viewer path
    // needs this.
    if (!matchId && requestedMatchId && process.env.DATABASE_URL) {
      const row = await prisma.match.findUnique({ where: { id: requestedMatchId }, select: { orgId: true, displayToken: true } });
      if (row && (!orgId || row.orgId === orgId)) {
        if (!isDisplayTokenValid(row.displayToken, requestedToken, DISPLAY_TOKEN_REQUIRED)) {
          next(new Error("invalid or missing display token"));
          return;
        }
        matchId = requestedMatchId;
        orgId = orgId ?? row.orgId;
      }
    }

    // Same reasoning as /state above: LEGACY_ROOM_ID isn't a real org once
    // DATABASE_URL is set, so falling through to it here would have every
    // under-specified viewer connection (no org, no resolvable matchId)
    // repeatedly fail to persist a Match row under a non-existent org.
    if (!orgId && process.env.DATABASE_URL) {
      next(new Error("org (or a valid matchId) is required"));
      return;
    }
    orgId = orgId ?? LEGACY_ROOM_ID;

    (socket as any).orgId = orgId;
    (socket as any).matchId = matchId;
    next();
  });

  io.on("connection", (socket) => {
    const orgId = (socket as any).orgId as string;
    const matchId = (socket as any).matchId as string | undefined;
    const isBridge   = (socket as any).isBridge   === true;
    const isControl  = (socket as any).isControl  === true;
    const isGraphics = (socket as any).isGraphics === true;
    const isDataFeed = (socket as any).isDataFeed === true;
    let role: "bridge" | "control" | "graphics" | "data-feed" | "viewer";
    if (isBridge) {
      role = "bridge";
    } else if (isControl) {
      role = "control";
    } else if (isGraphics) {
      role = "graphics";
    } else if (isDataFeed) {
      role = "data-feed";
    } else {
      role = "viewer";
    }

    const room = roomFor(orgId, matchId);
    socket.join(room);
    roomCounts.set(room, (roomCounts.get(room) ?? 0) + 1);
    console.log(`[+] ${role} connected to room ${room} (${socket.id})`);

    // Register listeners synchronously, before the async state load below —
    // otherwise a client emitting an update immediately on connect can race
    // ahead of `await getState(orgId)` and have its event silently dropped.
    if (isBridge) {
      const existingBridge = bridgeSockets.get(room);
      if (existingBridge) {
        console.warn(`[relay] Replacing existing bridge connection for room ${room}`);
        existingBridge.disconnect(true);
      }
      bridgeSockets.set(room, socket);

      socket.on("stateUpdate", async (rawState: unknown) => {
        const parsed = matchStateSchema.safeParse(rawState);
        if (!parsed.success) {
          console.warn(`[relay] rejected malformed stateUpdate from room ${room}:`, parsed.error.issues);
          return;
        }
        const state = parsed.data as MatchState;
        const current = await getState(orgId, matchId);
        if (state.sequenceId >= current.sequenceId) {
          setState(orgId, {
            ...state,
            home:         { ...state.home,    color: current.home.color,    logoUrl: current.home.logoUrl    },
            visitor:      { ...state.visitor, color: current.visitor.color, logoUrl: current.visitor.logoUrl },
            displayTheme: { ...current.displayTheme },
          }, matchId);
        }
      });
    }

    if (isControl) {
      const controlUserId = (socket as any).controlUserId as string | undefined;

      // Controller mutex: check if another controller already holds the token for this room.
      // Returns the outcome so callers with an ack (requestControl) can hand
      // it straight back to the client in the ack payload itself — a
      // delivery guaranteed by socket.io's ack/timeout mechanism, unlike the
      // separate controllerGranted/controllerConflict broadcasts below,
      // which the client also listens for but has no way to confirm it
      // received. Emitting both keeps existing callers (implicit
      // connect-time resolution, tests that don't use requestControl) working
      // unchanged.
      function resolveController(): "granted" | "conflict" {
        const now = Date.now();
        const existing = controllerTokens.get(room);
        const existingIsActive = existing && existing.socketId !== socket.id && existing.expiresAt > now;
        // The /setup page's socket disconnecting into /control's new socket
        // (or any refresh/reconnect) looks identical to a second controller
        // unless we can tell them apart. Two signals, both required:
        //   1. The held token is in its post-disconnect grace period
        //      (finite expiresAt — see the disconnect handler below), not a
        //      still-live socket (expiresAt: Infinity) — two tabs open at
        //      once under the same login must still conflict (see
        //      adversarial.spec.ts's "two tabs on the same match" test).
        //   2. The owning user matches this socket's — same operator, not a
        //      rival. Only trusted for JWT-authenticated sessions (userId
        //      set); ScopedToken and legacy shared-secret callers have no
        //      reliable per-user identity, so they keep the strict
        //      socketId-only check.
        const existingOwnerDisconnected = existing !== undefined && existing.expiresAt !== Infinity;
        const isSameOperatorHandoff =
          existingIsActive && existingOwnerDisconnected &&
          controlUserId !== undefined && existing.userId === controlUserId;

        if (existingIsActive && !isSameOperatorHandoff) {
          // Another controller is active — notify this socket so the UI can show a "take control?" prompt
          socket.emit("controllerConflict", { activeControllerId: existing.socketId });
          // Don't grant control yet; the client can send "takeControl" to revoke the existing token
          return "conflict";
        }
        // Grant control (no existing token, expired token, same operator's
        // new socket, or same socket reconnecting)
        controllerTokens.set(room, { socketId: socket.id, expiresAt: Infinity, userId: controlUserId });
        socket.emit("controllerGranted");
        return "granted";
      }

      resolveController();

      // Explicit, retryable version of the connect-time resolution above —
      // the client uses this (with an ack) when the initial emit is lost or
      // races another socket's disconnect cleanup on the same room, leaving
      // it stuck with neither controllerGranted nor controllerConflict. The
      // ack payload carries the outcome directly, so the client can act on
      // it even in the (still theoretical) case where the broadcast event
      // above doesn't arrive but the ack does.
      socket.on("requestControl", (ack?: (result: "granted" | "conflict") => void) => {
        const result = resolveController();
        ack?.(result);
      });

      // Client requests to take control from an existing controller
      socket.on("takeControl", () => {
        const prior = controllerTokens.get(room);
        if (prior && prior.socketId !== socket.id) {
          // Notify the displaced controller that they've lost control
          io.to(prior.socketId).emit("controllerRevoked");
        }
        controllerTokens.set(room, { socketId: socket.id, expiresAt: Infinity, userId: controlUserId });
        socket.emit("controllerGranted");
      });

      // Reject scoring events from sockets that don't hold the controller token
      function assertController(): boolean {
        const token = controllerTokens.get(room);
        return token?.socketId === socket.id;
      }

      socket.on("manualUpdate", async (rawPatch: unknown, ack?: () => void) => {
        if (!assertController()) { socket.emit("controllerConflict", {}); ack?.(); return; }
        const parsed = manualUpdateRequestSchema.safeParse(rawPatch);
        if (!parsed.success) {
          console.warn(`[relay] rejected malformed manualUpdate from room ${room}:`, parsed.error.issues);
          ack?.();
          return;
        }
        const { clientEventMs, ...patch } = parsed.data;
        await applyManualUpdate(orgId, patch as Partial<MatchState>, matchId, clientEventMs);
        const bridge = bridgeSockets.get(room);
        if (bridge?.connected) bridge.emit("manualUpdate", patch);
        ack?.();
      });

      // Latency-compensated wall-clock offset estimation for the operator's
      // control session — see useServerClockOffset.ts (client). Cheap,
      // stateless, no extra auth beyond the already-authenticated socket.
      socket.on("timeSync", (payload: { t0: number }) => {
        socket.emit("timeSyncResponse", { t0: payload?.t0, serverNow: Date.now() });
      });

      socket.on("resetMatch", async () => {
        if (!assertController()) { socket.emit("controllerConflict", {}); return; }
        const current = await getState(orgId, matchId);
        // Push pre-reset state to undo stack so resets can be undone
        const stack = undoStacks.get(room) ?? [];
        stack.push(current);
        if (stack.length > UNDO_STACK_SIZE) stack.shift();
        undoStacks.set(room, stack);
        const next: MatchState = {
          ...DEFAULT_MATCH_STATE,
          sequenceId: current.sequenceId + 1,
          home:    { ...DEFAULT_MATCH_STATE.home,    name: current.home.name,    color: current.home.color,    logoUrl: current.home.logoUrl    },
          visitor: { ...DEFAULT_MATCH_STATE.visitor, name: current.visitor.name, color: current.visitor.color, logoUrl: current.visitor.logoUrl },
          displayTheme: { ...current.displayTheme },
        };
        setState(orgId, next, matchId);
        const bridge = bridgeSockets.get(room);
        if (bridge?.connected) bridge.emit("manualUpdate", next);
      });

      socket.on("cricket:ball", async (rawPayload: unknown) => {
        if (!assertController()) { socket.emit("controllerConflict", {}); return; }
        const parsed = cricketBallEventSchema.safeParse(rawPayload);
        if (!parsed.success) {
          console.warn(`[relay] rejected malformed cricket:ball from room ${room}:`, parsed.error.issues);
          return;
        }
        const current = await getState(orgId, matchId);
        const nextSportState = applyCricketBall(current, parsed.data);
        await applyManualUpdate(orgId, { sportState: nextSportState }, matchId);
        const bridge = bridgeSockets.get(room);
        if (bridge?.connected) bridge.emit("manualUpdate", { sportState: nextSportState });
      });

      socket.on("cricket:overComplete", async (rawPayload: unknown) => {
        if (!assertController()) { socket.emit("controllerConflict", {}); return; }
        const parsed = cricketOverCompleteEventSchema.safeParse(rawPayload ?? {});
        if (!parsed.success) {
          console.warn(`[relay] rejected malformed cricket:overComplete from room ${room}:`, parsed.error.issues);
          return;
        }
        const current = await getState(orgId, matchId);
        const nextSportState = applyOverComplete(current, parsed.data);
        await applyManualUpdate(orgId, { sportState: nextSportState }, matchId);
        const bridge = bridgeSockets.get(room);
        if (bridge?.connected) bridge.emit("manualUpdate", { sportState: nextSportState });
      });

      socket.on("cricket:inningsChange", async (rawPayload: unknown) => {
        if (!assertController()) { socket.emit("controllerConflict", {}); return; }
        const parsed = cricketInningsChangeEventSchema.safeParse(rawPayload);
        if (!parsed.success) {
          console.warn(`[relay] rejected malformed cricket:inningsChange from room ${room}:`, parsed.error.issues);
          return;
        }
        const current = await getState(orgId, matchId);
        const nextSportState = applyInningsChange(current, parsed.data);
        await applyManualUpdate(orgId, { sportState: nextSportState }, matchId);
        const bridge = bridgeSockets.get(room);
        if (bridge?.connected) bridge.emit("manualUpdate", { sportState: nextSportState });
      });

      socket.on("cricket:declare", async (rawPayload: unknown) => {
        if (!assertController()) { socket.emit("controllerConflict", {}); return; }
        const parsed = cricketDeclareEventSchema.safeParse(rawPayload);
        if (!parsed.success) {
          console.warn(`[relay] rejected malformed cricket:declare from room ${room}:`, parsed.error.issues);
          return;
        }
        const current = await getState(orgId, matchId);
        const nextSportState = applyDeclare(current, parsed.data);
        await applyManualUpdate(orgId, { sportState: nextSportState }, matchId);
        const bridge = bridgeSockets.get(room);
        if (bridge?.connected) bridge.emit("manualUpdate", { sportState: nextSportState });
      });

      socket.on("undo", async () => {
        if (!assertController()) { socket.emit("controllerConflict", {}); return; }
        const stack = undoStacks.get(room);
        if (!stack?.length) return;
        const previous = stack.pop()!;
        undoStacks.set(room, stack);
        const current = matchStates.get(room);
        const restored: MatchState = {
          ...previous,
          // Keep sequenceId monotonic so viewers always accept the update
          sequenceId: (current?.state.sequenceId ?? previous.sequenceId) + 1,
          // Re-anchor a restored running clock to now, otherwise the next
          // tick would resync against a stale clockAnchorMs from whenever
          // this snapshot was captured and fast-forward by that whole gap.
          ...(previous.isRunning ? { clockAnchorMs: Date.now() } : {}),
        };
        matchStates.set(room, { orgId, matchId, state: restored });
        io.to(room).emit("matchStateChange", restored);
        getMatchStore(orgId, matchId)?.save(restored);
        publishStateUpdate(room, restored);
      });

      // Delta-based score mutations. Unlike manualUpdate (which trusts a
      // client-computed absolute value and merges via applyManualUpdate's
      // `await getState(...)`), these apply a delta against the relay's own
      // authoritative state and are kept fully synchronous — no `await`
      // anywhere in the handler body. That's deliberate: even an
      // already-resolved `await getState(...)` still defers its continuation
      // by a microtask tick, and if two rapid clicks dispatch their socket
      // events back-to-back in the same synchronous frame-parsing pass, both
      // handlers' reads could land before either write — reproducing the
      // exact stale-base-score coalescing bug this event exists to fix, just
      // moved server-side. Direct, synchronous matchStates access (matching
      // resetMatch/undo above, not applyManualUpdate) closes that window.
      socket.on("adjustScore", (rawPayload: unknown) => {
        if (!assertController()) { socket.emit("controllerConflict", {}); return; }
        const parsed = scoreAdjustEventSchema.safeParse(rawPayload);
        if (!parsed.success) {
          console.warn(`[relay] rejected malformed adjustScore from room ${room}:`, parsed.error.issues);
          return;
        }
        const { side, delta } = parsed.data;
        const entry = matchStates.get(room);
        if (!entry) return; // room is expected to always be warm by this point
        const current = entry.state;
        const stack = undoStacks.get(room) ?? [];
        stack.push(current);
        if (stack.length > UNDO_STACK_SIZE) stack.shift();
        undoStacks.set(room, stack);
        const next: MatchState = {
          ...current,
          sequenceId: current.sequenceId + 1,
          [side]: { ...current[side], score: Math.max(0, current[side].score + delta) },
        };
        setState(orgId, next, matchId);
        const bridge = bridgeSockets.get(room);
        if (bridge?.connected) bridge.emit("manualUpdate", { [side]: next[side] });
      });

      // Indoor cricket's "take a wicket" action atomically combines a score
      // decrement (by the configured wicketPenalty) with a wicket-count
      // increment on the same side — same synchronous-only requirement as
      // adjustScore above, and for the same reason.
      socket.on("indoorCricket:wicket", (rawPayload: unknown) => {
        if (!assertController()) { socket.emit("controllerConflict", {}); return; }
        const parsed = indoorCricketWicketEventSchema.safeParse(rawPayload);
        if (!parsed.success) {
          console.warn(`[relay] rejected malformed indoorCricket:wicket from room ${room}:`, parsed.error.issues);
          return;
        }
        const { side } = parsed.data;
        const entry = matchStates.get(room);
        if (!entry) return;
        const current = entry.state;
        const cricketState = current.sportState as IndoorCricketState | undefined;
        const wicketPenalty = Number(current.sportConfig?.wicketPenalty ?? 5);
        const stack = undoStacks.get(room) ?? [];
        stack.push(current);
        if (stack.length > UNDO_STACK_SIZE) stack.shift();
        undoStacks.set(room, stack);
        const next: MatchState = {
          ...current,
          sequenceId: current.sequenceId + 1,
          [side]: { ...current[side], score: Math.max(0, current[side].score - wicketPenalty) },
          sportState: {
            sport: "indoor_cricket",
            wicketPenalty: wicketPenalty === 2 ? 2 : 5,
            oversPerInnings: cricketState?.oversPerInnings ?? 8,
            homeWickets: side === "home" ? (cricketState?.homeWickets ?? 0) + 1 : (cricketState?.homeWickets ?? 0),
            visitorWickets: side === "visitor" ? (cricketState?.visitorWickets ?? 0) + 1 : (cricketState?.visitorWickets ?? 0),
          },
        };
        setState(orgId, next, matchId);
        const bridge = bridgeSockets.get(room);
        if (bridge?.connected) bridge.emit("manualUpdate", { [side]: next[side], sportState: next.sportState });
      });
    }

    // Graphics Operator add-on scene switching. Deliberately its own block,
    // separate from the isControl block above: scene selection has no
    // controller mutex (last-write-wins, see sceneStates comment) and must
    // be reachable by isGraphics sockets, which never enter the isControl
    // block at all — this is the structural half of keeping graphics-scoped
    // connections away from scoring-mutation handlers (manualUpdate,
    // stateUpdate, cricket:*, undo, resetMatch all live inside isControl/
    // isBridge blocks only). Per product decision, a control-role operator
    // may also drive scenes solo (small venues), hence isControl is included.
    if (isControl || isGraphics) {
      socket.on("setScene", (rawScene: unknown) => {
        const parsed = graphicsSceneSchema.safeParse(rawScene);
        if (!parsed.success) {
          console.warn(`[relay] rejected malformed setScene from room ${room}:`, parsed.error.issues);
          return;
        }
        const scene = { ...parsed.data, updatedAt: new Date().toISOString() };
        sceneStates.set(room, scene);
        io.to(room).emit("graphicsSceneUpdate", scene);
      });
    }

    socket.on("disconnect", () => {
      if (isBridge && bridgeSockets.get(room) === socket) bridgeSockets.delete(room);
      // Start controller token TTL on disconnect so a page refresh doesn't lose control,
      // but another person can take over if the original controller is genuinely gone.
      if (isControl) {
        const token = controllerTokens.get(room);
        if (token?.socketId === socket.id) {
          controllerTokens.set(room, { socketId: socket.id, expiresAt: Date.now() + CONTROLLER_TOKEN_TTL_MS, userId: token.userId });
        }
      }
      const remaining = (roomCounts.get(room) ?? 1) - 1;
      if (remaining <= 0) {
        roomCounts.delete(room);
        // Only matchId-scoped rooms are ever evicted — the org-singleton
        // ("default") room is cached for the process lifetime as before.
        if (matchId) {
          matchStates.delete(room);
          undoStacks.delete(room);
          controllerTokens.delete(room);
          sceneStates.delete(room);
          evictMatchStore(orgId, matchId).catch(err =>
            console.error("[relay] failed to evict match store on last disconnect:", room, err)
          );
        }
      } else {
        roomCounts.set(room, remaining);
      }
      console.log(`[-] ${role} disconnected from room ${room} (${socket.id})`);
    });

    getState(orgId, matchId)
      .then(state => socket.emit("matchStateChange", state))
      .catch(err => {
        if (err instanceof ConcurrentMatchLimitError) {
          socket.emit("error", { message: err.message });
          return;
        }
        if (err instanceof MatchNotFoundError) {
          socket.emit("error", { message: "match not found" });
          return;
        }
        console.error("[relay] failed to load initial state for room:", room, err);
      });

    const scene = sceneStates.get(room);
    if (scene) socket.emit("graphicsSceneUpdate", scene);
  });

  function close(cb?: (err?: Error) => void) {
    clearInterval(clockInterval);
    const flushes = allActiveStores().map(store =>
      store.flush().catch(err => console.error(`[relay] failed to flush match state for org ${store.orgId} on close`, err))
    );
    Promise.allSettled(flushes).finally(() =>
      closeRedis()
        .catch(err => console.error("[relay] failed to close redis clients on close", err))
        .finally(() => io.close(cb))
    );
  }

  // Catches errors thrown before a route handler runs — chiefly multer
  // (file-too-large, fileFilter rejection) — which otherwise bubble up as a
  // bare unlogged 500 with no context on what failed or why (SA-10).
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[relay] unhandled error:", req.method, req.path, err);
    captureException(err, { method: req.method, path: req.path });
    if (res.headersSent) return;
    const message = err instanceof multer.MulterError ? err.message : "internal server error";
    res.status(err instanceof multer.MulterError ? 400 : 500).json({ error: message });
  });

  return { app, io, httpServer, close };
}
