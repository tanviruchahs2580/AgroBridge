# Digest-pinned base images (tag kept in the reference for humans): a retagged
# image would otherwise change the build with no commit in between.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
# --include-workspace-root: root devDeps (prisma) must be present for the root
# postinstall hook (prisma generate) — CI api-quality uses the same pattern.
COPY scripts/generate-prisma.mjs ./scripts/generate-prisma.mjs
RUN npm ci --workspace apps/web --include-workspace-root
COPY . .
WORKDIR /app/apps/web
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build
# ---- runtime stage: minimal, patched nginx (fixes 4 HIGH in nginx:alpine's
# util-linux/libxml2 via the slimmer base + apk upgrade) ----
# nginx:1-alpine-slim
FROM nginx:1-alpine-slim@sha256:ebd058041a732a2b2dc0b606e34572dd8e0034de6a4aa4d50d8c13a240ac6005
RUN apk upgrade --no-cache
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/web.nginx.prod.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
