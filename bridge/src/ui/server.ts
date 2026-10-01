import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { BridgeController, BridgeConfig } from "../controller";
import { addSseClient, removeSseClient } from "../logger";
import type { UpdateChecker } from "../updateChecker";

function isPrivateOrReservedHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h === "::1") return true;
  if (h.startsWith("127.")) return true;
  if (h.startsWith("10.")) return true;
  if (h.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (h.startsWith("169.254.")) return true;
  if (h.startsWith("100.6") || h.startsWith("100.7") || /^100\.(?:[6-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (h === "0.0.0.0") return true;
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;
  return false;
}

function validateScrapeUrl(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("cdScrapeUrl must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("cdScrapeUrl must not include credentials");
  }
  if (isPrivateOrReservedHost(parsed.hostname)) {
    throw new Error("cdScrapeUrl host is not allowed");
  }
  return parsed.toString();
}

export function createUiServer(
  controller: BridgeController,
  port: number = 4002,
  updateChecker?: UpdateChecker
): ReturnType<typeof createServer> {
  const app = express();
  app.use(express.json());

  // Serve the HTML UI — works for both ts-node-dev (src/ui) and compiled (dist/ui)
  app.use(express.static(path.join(__dirname, "public")));

  // ── Status ──────────────────────────────────────────────────────────────────

  app.get("/api/status", (_req, res) => {
    res.json({
      status: controller.status,
      lastError: controller.lastError,
      relay: controller.getRelayHealth(),
      state: {
        home: controller.getState().home.score,
        visitor: controller.getState().visitor.score,
        matchName: controller.getState().matchName,
        isRunning: controller.getState().isRunning,
        period: controller.getState().period,
        inputSource: controller.getState().inputSource,
        netballStats: !!controller.getState().netballStats,
      },
    });
  });

  // ── Updates (SA-112) ────────────────────────────────────────────────────────

  app.get("/api/update", (_req, res) => {
    res.json(updateChecker?.getState() ?? null);
  });

  app.post("/api/update/check", async (_req, res) => {
    if (!updateChecker) {
      res.status(404).json({ error: "Update checks are not enabled" });
      return;
    }
    res.json(await updateChecker.check(true));
  });

  // ── Config ──────────────────────────────────────────────────────────────────

  app.get("/api/config", (_req, res) => {
    res.json(controller.getConfig());
  });

  app.post("/api/config", (req, res) => {
    const patch = req.body as Partial<BridgeConfig>;
    // Coerce number fields that come in as strings from the form
    if (patch.baudRate) patch.baudRate = Number(patch.baudRate);
    if (patch.cdPollMs) patch.cdPollMs = Number(patch.cdPollMs);
    if (patch.cdScrapePollMs) patch.cdScrapePollMs = Number(patch.cdScrapePollMs);
    if (typeof patch.cdScrapeUrl === "string" && patch.cdScrapeUrl.trim() !== "") {
      try {
        patch.cdScrapeUrl = validateScrapeUrl(patch.cdScrapeUrl);
      } catch (err) {
        res.status(400).json({ ok: false, error: (err as Error).message });
        return;
      }
    }
    controller.updateConfig(patch);
    res.json({ ok: true, config: controller.getConfig() });
  });

  // ── Control ─────────────────────────────────────────────────────────────────

  app.post("/api/start", async (_req, res) => {
    await controller.start();
    res.json({ status: controller.status, lastError: controller.lastError });
  });

  app.post("/api/stop", async (_req, res) => {
    await controller.stop();
    res.json({ status: controller.status });
  });

  app.post("/api/restart", async (_req, res) => {
    await controller.restart();
    res.json({ status: controller.status, lastError: controller.lastError });
  });

  // ── Serial ports ─────────────────────────────────────────────────────────────

  app.get("/api/ports", async (_req, res) => {
    try {
      const ports = await controller.listSerialPorts();
      res.json({ ports });
    } catch (err) {
      res.json({ ports: [], error: (err as Error).message });
    }
  });

  // ── SSE log stream ───────────────────────────────────────────────────────────

  app.get("/api/logs", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    addSseClient(res);

    req.on("close", () => removeSseClient(res));
  });

  const server = createServer(app);
  server.listen(port, () => {
    console.log(`[ui] Bridge admin UI → http://localhost:${port}`);
  });

  return server;
}
