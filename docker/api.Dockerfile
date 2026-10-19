# ---- build stage: full toolchain (dev deps) for compile + prisma client ----
# Base images are digest-pinned (tag kept in the reference for humans): a
# retagged `node:22-alpine` would otherwise change what we build and ship with
# no commit in between. node:22-alpine
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY scripts/generate-prisma.mjs ./scripts/generate-prisma.mjs
RUN npm ci --workspace apps/api
COPY apps/api/ ./apps/api/
WORKDIR /app/apps/api
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
RUN npx prisma generate
RUN npm run build

# ---- runtime stage: production deps only, freshest patches ----
# node:22-alpine (same digest as the build stage)
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
RUN apk upgrade --no-cache
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts
RUN rm -rf \
  /app/node_modules/prisma \
  /app/node_modules/@prisma/config \
  /app/node_modules/@prisma/engines \
  /app/node_modules/deepmerge-ts \
  /app/node_modules/.bin/prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app/apps/api
# Run as the unprivileged `node` user shipped with the base image (Phase 13:
# no root containers). uploads/ is pre-created writable for local-storage mode.
RUN mkdir -p /app/apps/api/uploads/disease && chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
