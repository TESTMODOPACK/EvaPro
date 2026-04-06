# ── Eva360 API — Production Dockerfile ──────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm run build

# ── Production stage ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Run migrations + seed + start
CMD ["sh", "-c", "node dist/database/cleanup-orphans.js && node dist/database/seed.js && node dist/database/seed-demo-full.js && node dist/main"]
