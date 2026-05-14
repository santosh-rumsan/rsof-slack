# ── Stage 1: Build frontend ───────────────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /build/apps/web
COPY apps/web/package.json ./
RUN npm install
COPY apps/web/ .
RUN npm run build

# ── Stage 2: Build NestJS API ─────────────────────────────────────────────
FROM node:20-slim AS api-builder

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /build/apps/api
COPY apps/api/package.json apps/api/package-lock.json* ./
RUN npm install
COPY apps/api/ .
RUN npx prisma generate
RUN npm run build

# ── Stage 3: Production runtime ───────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y curl openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production deps
COPY apps/api/package.json ./
RUN npm install --omit=dev && \
    sed -i 's/if (error !== undefined)/if (error)/' node_modules/@slack/rtm-api/dist/RTMClient.js

# Copy built app and prisma schema (needed for migrate deploy + generate)
COPY --from=api-builder /build/apps/api/dist ./dist
COPY --from=api-builder /build/apps/api/prisma ./prisma

# Generate Prisma client in production image
RUN npx prisma generate

# Copy built frontend
COPY --from=frontend-builder /build/apps/web/dist ./frontend/dist

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
