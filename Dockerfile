FROM node:22-alpine

# ── Build hypermail-mcp ──

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate

# hypermail-mcp source must be in a ./hypermail-mcp/ subdirectory
# (git submodule or copied before build)
COPY hypermail-mcp/ ./
RUN pnpm install --frozen-lockfile && pnpm build && pnpm prune --prod

# ── Install monday.com script ──

RUN mkdir -p /scripts
COPY dist/on-email.mjs /scripts/on-email.mjs

# ── Provide a default watch config (env vars override) ──

COPY hypermail-config.json ./hypermail-config.json

# ── Runtime ──

ENV NODE_ENV=production
EXPOSE 3000

# Persistent token/account storage (mount /data in Dokploy)
RUN mkdir -p /data

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/mcp',()=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "dist/cli.js", "--http", "--port", "3000", "--host", "0.0.0.0", "--data-dir", "/data"]
