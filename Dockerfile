FROM ghcr.io/mebezac/byoc-base-image:2026.2.0 AS base

WORKDIR /app

FROM base AS deps

COPY --chown=opencode:opencode package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --chown=opencode:opencode shared/package.json ./shared/
COPY --chown=opencode:opencode backend/package.json ./backend/
COPY --chown=opencode:opencode frontend/package.json ./frontend/

RUN --mount=type=cache,id=pnpm,target=/opt/pnpm/store,uid=1000,gid=1000,mode=0775 \
  pnpm install --frozen-lockfile

FROM base AS builder

COPY --chown=opencode:opencode package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --chown=opencode:opencode shared/package.json ./shared/
COPY --chown=opencode:opencode backend/package.json ./backend/
COPY --chown=opencode:opencode frontend/package.json ./frontend/

RUN --mount=type=cache,id=pnpm-builder,target=/opt/pnpm/store,uid=1000,gid=1000,mode=0775 \
  pnpm install --frozen-lockfile

COPY --chown=opencode:opencode shared/src ./shared/src
COPY --chown=opencode:opencode frontend/src ./frontend/src
COPY --chown=opencode:opencode frontend/public ./frontend/public
COPY --chown=opencode:opencode frontend/index.html frontend/vite.config.ts frontend/tsconfig*.json frontend/components.json frontend/eslint.config.js ./frontend/

RUN pnpm --filter frontend build

FROM base AS runner

ARG OPENCODE_VERSION=1.1.53

RUN mise use -g opencode@${OPENCODE_VERSION}

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5003
ENV OPENCODE_SERVER_PORT=5551
ENV DATABASE_PATH=/app/data/opencode.db
ENV WORKSPACE_PATH=/workspace

COPY --from=deps --chown=opencode:opencode /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --chown=opencode:opencode backend ./backend
COPY --from=deps --chown=opencode:opencode /app/backend/node_modules ./backend/node_modules
COPY --from=deps --chown=opencode:opencode /app/shared/node_modules ./shared/node_modules
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY package.json pnpm-workspace.yaml ./

COPY --chown=opencode:opencode --chmod=755 scripts/docker-entrypoint.sh /docker-entrypoint.sh

RUN mkdir -p /workspace /app/data

EXPOSE 5003

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5003/api/health || exit 1

USER opencode

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "backend/src/index.ts"]
