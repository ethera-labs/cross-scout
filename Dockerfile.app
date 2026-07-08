FROM oven/bun:alpine AS builder

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps ./apps

RUN bun install --frozen-lockfile

# Explorer build is same-origin: the api serves it from its own host, so no
# VITE_API_URL/VITE_API_PORT is set here. VITE_CHAIN_NAMES is display-only
# config baked into the bundle.
ARG VITE_CHAIN_NAMES=
ENV VITE_CHAIN_NAMES=$VITE_CHAIN_NAMES

RUN bun run --cwd apps/crossscout build

FROM oven/bun:alpine

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json turbo.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY packages ./packages
COPY apps/api ./apps/api
COPY --from=builder /app/apps/crossscout/dist ./apps/crossscout/dist

ENV NODE_ENV=production
EXPOSE 3001

# 127.0.0.1, not localhost: busybox wget resolves localhost to ::1 first and
# Bun's 0.0.0.0 bind doesn't answer on the IPv6 loopback.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["bun", "run", "--cwd", "apps/api", "start"]
