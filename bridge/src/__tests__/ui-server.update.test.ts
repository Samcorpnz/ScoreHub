import request from "supertest";
import { AddressInfo } from "node:net";
import { createUiServer } from "../ui/server";
import type { BridgeController } from "../controller";
import type { UpdateChecker, UpdateState } from "../updateChecker";

const controller = {} as BridgeController;

function listen(checker?: UpdateChecker): Promise<{ server: ReturnType<typeof createUiServer>; baseUrl: string }> {
  const server = createUiServer(controller, 0, checker);
  return new Promise((resolve) => {
    server.on("listening", () => {
      resolve({ server, baseUrl: `http://localhost:${(server.address() as AddressInfo).port}` });
    });
  });
}

const available: UpdateState = {
  currentVersion: "1.0.0",
  status: "available",
  latestVersion: "1.1.0",
  downloadUrl: "https://downloads.scorehub.co.nz/mac",
  checkedAt: 1,
};

describe("ui server update routes (SA-112)", () => {
  it("GET /api/update returns the checker state", async () => {
    const checker = { getState: jest.fn(() => available) } as unknown as UpdateChecker;
    const { server, baseUrl } = await listen(checker);
    try {
      const res = await request(baseUrl).get("/api/update");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(available);
    } finally {
      server.close();
    }
  });

  it("POST /api/update/check runs a manual check and returns the result", async () => {
    const check = jest.fn(async () => ({ ...available, status: "up-to-date" as const }));
    const checker = { getState: jest.fn(), check } as unknown as UpdateChecker;
    const { server, baseUrl } = await listen(checker);
    try {
      const res = await request(baseUrl).post("/api/update/check");
      expect(check).toHaveBeenCalledWith(true);
      expect(res.body.status).toBe("up-to-date");
    } finally {
      server.close();
    }
  });

  it("returns null / 404 when no checker is configured (headless run)", async () => {
    const { server, baseUrl } = await listen();
    try {
      const get = await request(baseUrl).get("/api/update");
      expect(get.status).toBe(200);
      expect(get.body).toBeNull();
      expect((await request(baseUrl).post("/api/update/check")).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
