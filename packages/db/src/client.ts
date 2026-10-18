import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// Reuse a single PrismaClient across hot reloads (Next.js dev) and across
// the relay's long-lived process, instead of exhausting Postgres connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  // node-postgres closes a connection after 10s idle by default, so a quiet
  // relay paid a fresh TCP+TLS+auth handshake to Neon (~0.3–1.6s) on nearly
  // every query; the query itself is single-digit ms. Hold idle connections
  // for a few minutes instead. keepAlive lets a connection Neon dropped
  // (compute suspend) be noticed rather than handed out dead.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    idleTimeoutMillis: 5 * 60_000,
    keepAlive: true,
  });
  return globalForPrisma.prisma ?? new PrismaClient({ adapter });
}

// Built lazily, on first actual use of `prisma`, rather than at module-import
// time — this module is imported (transitively, via relay/frontend code) well
// before some callers (e.g. tests that stub DATABASE_URL in beforeAll) get a
// chance to set process.env.DATABASE_URL. Reading it eagerly at import would
// permanently bake in whatever value (or lack of one) was present at that
// earlier point.
let client: PrismaClient | undefined;

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    if (!client) {
      client = createPrismaClient();
      if (process.env.NODE_ENV !== "production") {
        globalForPrisma.prisma = client;
      }
    }
    return Reflect.get(client as object, prop, receiver);
  },
});
