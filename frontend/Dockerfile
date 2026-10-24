# Build context is the repo root, not frontend/ — frontend depends on the
# internal @scorehub/db workspace package (Prisma client) and runs
# `prisma migrate deploy` on startup, same reasoning as relay/Dockerfile.

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:25-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY scripts ./scripts
COPY frontend/package.json ./frontend/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY relay/package.json ./relay/
COPY bridge/package.json ./bridge/
RUN npm ci

COPY packages/db ./packages/db
RUN npm run build --workspace=@scorehub/db

COPY packages/types ./packages/types
RUN npm run build --workspace=@scorehub/types

ARG NEXT_PUBLIC_RELAY_URL
ENV NEXT_PUBLIC_RELAY_URL=$NEXT_PUBLIC_RELAY_URL

ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

COPY frontend ./frontend
RUN npm run build --workspace=frontend

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:25-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/types ./packages/types
COPY --from=builder /app/frontend/package.json ./frontend/
COPY --from=builder /app/frontend/.next ./frontend/.next
COPY --from=builder /app/frontend/public ./frontend/public

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
WORKDIR /app/frontend

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy --config ../packages/db/prisma.config.ts && npm start"]
