# syntax=docker/dockerfile:1.7
#
# Multi-stage Docker build for the SovereignClaw dev oracle.
#
# Strategy:
#   1. `deps`  — install the full pnpm workspace using a frozen lockfile,
#                so package.json files for every workspace member are in
#                place and pnpm doesn't try to recompute the dep graph.
#   2. `build` — copy the source, build the publishable libraries the
#                backend depends on (memory, inft) plus the backend itself,
#                then call `pnpm deploy` to produce a self-contained
#                runtime bundle at /repo/deploy-out. `pnpm deploy` resolves
#                hoisted deps out of the workspace store into a real,
#                non-symlinked node_modules tree — fixes the
#                ERR_MODULE_NOT_FOUND that plain `cp node_modules` causes
#                on pnpm workspaces.
#   3. `runtime` — copy /repo/deploy-out into a slim image and run
#                  `node dist/server.js`. Carries `contracts/out` and
#                  `deployments/` so the EIP-712 fixture and ABI JSON are
#                  reachable at runtime.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ---------------------------------------------------------------------------
# deps: install full workspace with the frozen lockfile
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json turbo.json ./
COPY .changeset ./.changeset

# Every workspace member's package.json is required for pnpm install to
# resolve the lockfile. Glob-copying via `apps`, `packages`, `examples`
# directories would also pull source we don't need at install time, so we
# enumerate explicitly. If a new workspace member is added, add its
# package.json here.
COPY packages/core/package.json        packages/core/
COPY packages/memory/package.json      packages/memory/
COPY packages/mesh/package.json        packages/mesh/
COPY packages/inft/package.json        packages/inft/
COPY packages/reflection/package.json  packages/reflection/
COPY packages/studio/package.json      packages/studio/
COPY apps/backend/package.json         apps/backend/
COPY apps/docs/package.json            apps/docs/
COPY examples/agent-hello/package.json                       examples/agent-hello/
COPY examples/agent-mint-transfer-revoke/package.json        examples/agent-mint-transfer-revoke/
COPY examples/research-mesh/package.json                     examples/research-mesh/

# `pnpm install` resolves $NPM_TOKEN from .npmrc; an empty value keeps
# install for unauthenticated public packages working inside the build.
ENV NPM_TOKEN=""
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: build the libraries the backend uses, then `pnpm deploy`
# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY contracts ./contracts
COPY deployments ./deployments

# Build only what the backend needs. Order matters because of internal deps.
RUN pnpm --filter @sovereignclaw/memory build \
 && pnpm --filter @sovereignclaw/inft build \
 && pnpm --filter @sovereignclaw/backend build

# Produce a self-contained runtime bundle. `--prod` strips devDeps. The
# output directory contains: dist/, node_modules/ (real tree, no hoist
# symlinks), package.json with workspace:* rewritten to inline refs.
RUN pnpm deploy --filter=@sovereignclaw/backend --prod /repo/deploy-out

# ---------------------------------------------------------------------------
# runtime: minimal Node image with the deployed bundle
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8787
# `loadDeployment()` walks up from the inft package by default; in a
# production install the inft package lives under node_modules/.pnpm/...
# which doesn't contain a `deployments/` sibling. Pin the path here so
# the backend reads from /app/deployments/0g-testnet.json. Overrideable
# at deploy time if needed.
ENV DEPLOYMENT_PATH=/app/deployments/0g-testnet.json
WORKDIR /app

COPY --from=build /repo/deploy-out/dist ./dist
COPY --from=build /repo/deploy-out/node_modules ./node_modules
COPY --from=build /repo/deploy-out/package.json ./package.json

# Repo-level deployments + contract ABI artifacts live next to the
# bundle. ABIs are also baked into @sovereignclaw/inft at publish time
# (tsup inlines the JSON), so contracts/out is belt-and-suspenders.
COPY --from=build /repo/contracts/out ./contracts/out
COPY --from=build /repo/deployments ./deployments

# wget is in the base node:22-alpine image; healthcheck uses it.
EXPOSE 8787
CMD ["node", "dist/server.js"]
