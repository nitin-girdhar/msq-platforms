# Self-contained image built from a `pnpm deploy` output.
# See docs/Platform_Architecture_Decisions.md (D5) and scripts/docker-ship.sh /
# scripts/docker-load.md for how to ship and run this image.
# Build from the repo root: `docker build -f apps/admin-web/Dockerfile .`
#
# NOTE: this app depends on @hr/web (msq-hrms/packages/hr-web) via a cross-repo
# pnpm workspace link, so the build context MUST include the msq-hrms repo
# checked out alongside msq-core (same requirement msq-hrms already accepts for
# @platform/* today) — see root pnpm-workspace.yaml header comment.
FROM node:22-alpine AS base
RUN npm install -g pnpm@9.15.0
WORKDIR /repo

FROM base AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG API_GATEWAY_INTERNAL_URL=http://api-gateway:4000
ENV API_GATEWAY_INTERNAL_URL=$API_GATEWAY_INTERNAL_URL
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @crm/admin-web... build
RUN pnpm --filter @crm/admin-web deploy --prod /app

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
# 3004, matching package.json's `start` script and the published port. Keep
# these in lockstep — a mismatch here reproduces the origin bug documented in
# lookup-admin's Dockerfile (listening port leaking into a derived callback URL).
EXPOSE 3004
CMD ["node_modules/.bin/next", "start", "--port", "3004"]
