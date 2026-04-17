# ── Eva360 Web — Production Dockerfile ──────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy monorepo root config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/

# Install dependencies
RUN pnpm install --no-frozen-lockfile --filter web...

# Copy web source
COPY apps/web/ apps/web/

# Build args for API URL (injected at build time)
ARG NEXT_PUBLIC_API_URL=http://api:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# ── Sentry source maps (P1.4) ────────────────────────────────────────
# Si estos build args están presentes, @sentry/nextjs sube los source
# maps a Sentry durante el build → los stack traces en el dashboard
# salen legibles (con los nombres originales de variables/funciones).
# Si no están, el build no falla — solo se pierde el beneficio de los
# stack traces bonitos. Crear el token en:
#   sentry.io → Settings → Auth Tokens → scope: project:releases + project:write
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ARG SENTRY_RELEASE=""
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
ENV SENTRY_RELEASE=$SENTRY_RELEASE

# Build Next.js (Sentry plugin lee las env vars arriba para subir sourcemaps)
RUN cd apps/web && pnpm run build

# ── Production stage ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy built app + node_modules
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/web/package.json apps/web/
COPY --from=builder /app/apps/web/.next apps/web/.next
COPY --from=builder /app/apps/web/public apps/web/public
COPY --from=builder /app/apps/web/next.config.mjs apps/web/
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/apps/web/node_modules apps/web/node_modules

WORKDIR /app/apps/web
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

CMD ["npx", "next", "start", "-p", "3001"]
