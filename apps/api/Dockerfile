# ── Eva360 API — Production Dockerfile ──────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ── Production stage ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Run migrations + seed + start
CMD ["sh", "-c", "node dist/database/cleanup-orphans.js && node dist/database/seed.js && node dist/database/seed-demo-full.js && node dist/main"]
