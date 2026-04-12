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

# Start the app. Los seeds (seed.js y seed-demo-full.js) YA NO corren en
# el CMD — eran la causa raiz del bug del add-on IA que reaparecia (y de
# otros efectos colaterales en cada reboot del container). Para
# bootstrapear el demo en un entorno nuevo, correr manualmente:
#
#   docker compose exec api node dist/database/seed.js
#   docker compose exec api node dist/database/seed-demo-full.js
#
# `cleanup-orphans.js` SI sigue corriendo porque es idempotente y solo
# borra filas huerfanas (no reescribe datos del usuario).
CMD ["sh", "-c", "node dist/database/cleanup-orphans.js && node dist/main"]
