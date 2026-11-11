# Digest-pinned base images (tag kept in the reference for humans): a retagged
# image would otherwise change the build with no commit in between.
FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build
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
