# Self-contained image built from a `pnpm deploy` output.
# See docs/Platform_Architecture_Decisions.md (D5) and scripts/docker-ship.sh /
# scripts/docker-load.md for how to ship and run this image.
# Build from the repo root: `docker build -f apps/lookup-admin/Dockerfile .`
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
RUN pnpm --filter @crm/lookup-admin... build
RUN pnpm --filter @crm/lookup-admin deploy --prod /app

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
# 3005, matching package.json's `start` script and the published port. It used
# to listen on 3001 and be published on 3005, which put the container's own
# origin (http://localhost:3001) on top of NEXT_PUBLIC_LMS_URL — anything
# deriving a URL from the listening port, as the auth bounce once did, produced
# a valid-looking LMS URL instead of an admin one.
EXPOSE 3005
CMD ["node_modules/.bin/next", "start", "--port", "3005"]
