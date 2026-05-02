# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ---- deps ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json turbo.json ./
COPY .changeset ./.changeset
COPY packages/memory/package.json packages/memory/
COPY packages/core/package.json packages/core/
COPY packages/inft/package.json packages/inft/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY contracts ./contracts
COPY deployments ./deployments
RUN pnpm --filter @sovereignclaw/memory build \
 && pnpm --filter @sovereignclaw/inft build \
 && pnpm --filter @sovereignclaw/backend build

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app
COPY --from=build /repo/apps/backend/dist ./dist
COPY --from=build /repo/apps/backend/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/contracts/out ./contracts/out
COPY --from=build /repo/deployments ./deployments
EXPOSE 8787
CMD ["node", "dist/server.js"]
