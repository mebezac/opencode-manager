FROM node:24.13.0-bookworm AS base

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    lsof \
    ripgrep \
    ca-certificates \
    grep \
    gawk \
    sed \
    findutils \
    coreutils \
    procps \
    jq \
    less \
    tree \
    file \
    python3 \
    python3-pip \
    python3-venv \
    unzip \
    screen \
    htop \
    tmux \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV MISE_INSTALL_PATH="/usr/local/bin/mise"

RUN curl https://mise.run | sh && \
    echo 'eval "$(mise activate bash)"' >> /etc/bash.bashrc && \
    mise --version

ARG BUN_VARIANT=""
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
        BUN_ARCH="x64"; \
        if [ -n "${BUN_VARIANT}" ]; then \
            BUN_URL="https://github.com/oven-sh/bun/releases/latest/download/bun-linux-${BUN_ARCH}-${BUN_VARIANT}.zip"; \
        else \
            BUN_URL="https://github.com/oven-sh/bun/releases/latest/download/bun-linux-${BUN_ARCH}.zip"; \
        fi; \
    elif [ "$ARCH" = "arm64" ]; then \
        BUN_ARCH="aarch64"; \
        BUN_URL="https://github.com/oven-sh/bun/releases/latest/download/bun-linux-${BUN_ARCH}.zip"; \
    else \
        echo "Unsupported architecture: $ARCH" && exit 1; \
    fi && \
    echo "Downloading Bun from: ${BUN_URL}" && \
    curl -fsSL "${BUN_URL}" -o /tmp/bun.zip && \
    unzip /tmp/bun.zip -d /tmp && \
    mkdir -p /opt/bun/bin && \
    mv /tmp/bun-linux-${BUN_ARCH}*/bun /opt/bun/bin/ && \
    chmod +x /opt/bun/bin/bun && \
    ln -s /opt/bun/bin/bun /usr/local/bin/bun && \
    rm -rf /tmp/bun.zip /tmp/bun-linux-*

WORKDIR /app

FROM base AS deps

COPY --chown=node:node package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --chown=node:node shared/package.json ./shared/
COPY --chown=node:node backend/package.json ./backend/
COPY --chown=node:node frontend/package.json ./frontend/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS builder

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN --mount=type=cache,id=pnpm-builder,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY shared/src ./shared/src
COPY frontend/src ./frontend/src
COPY frontend/public ./frontend/public
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig*.json frontend/components.json frontend/eslint.config.js ./frontend/

RUN pnpm --filter frontend build

FROM base AS runner

ARG UV_VERSION=0.9.28
ARG OPENCODE_VERSION=1.1.48

RUN echo "Installing uv=${UV_VERSION} opencode=${OPENCODE_VERSION}" && \
    curl -LsSf https://astral.sh/uv/${UV_VERSION}/install.sh | UV_NO_MODIFY_PATH=1 sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx && \
    chmod +x /usr/local/bin/uv /usr/local/bin/uvx && \
    if [ "${OPENCODE_VERSION}" = "latest" ]; then \
        curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path; \
    else \
        curl -fsSL https://opencode.ai/install | bash -s -- --version ${OPENCODE_VERSION} --no-modify-path; \
    fi && \
    mv /root/.opencode /opt/opencode && \
    chmod -R 755 /opt/opencode && \
    ln -s /opt/opencode/bin/opencode /usr/local/bin/opencode

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5003
ENV OPENCODE_SERVER_PORT=5551
ENV DATABASE_PATH=/app/data/opencode.db
ENV WORKSPACE_PATH=/workspace
ENV MISE_DATA_DIR=/workspace/mise
ENV MISE_CONFIG_DIR=/workspace/mise/config
ENV MISE_CACHE_DIR=/workspace/mise/cache
ENV PATH="/workspace/mise/shims:$PATH"

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --chown=node:node backend ./backend
COPY --from=deps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY package.json pnpm-workspace.yaml ./

COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p /workspace /app/data /workspace/mise /workspace/mise/config /workspace/mise/cache /workspace/mise/shims && \
    chown -R node:node /workspace /app/data

EXPOSE 5003 5100 5101 5102 5103

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5003/api/health || exit 1

USER node

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "backend/src/index.ts"]

