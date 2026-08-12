FROM node:24.18.0-bookworm-slim AS build

RUN npm install --global pnpm@11.16.0
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/discord/package.json packages/discord/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN pnpm install --frozen-lockfile

COPY apps/worker apps/worker
COPY packages packages
RUN pnpm build && pnpm --filter @yapbot/worker deploy --prod --legacy /release

FROM node:24.18.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /release/ ./
COPY --from=build --chown=node:node /workspace/packages/db/migrations ./packages/db/migrations

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "process.kill(1, 0)" || exit 1

CMD ["sh", "-c", "node node_modules/@yapbot/db/dist/migrate.js && exec node --enable-source-maps dist/main.js"]
