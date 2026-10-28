# Digest-pinned base images (tag kept in the reference for humans): a retagged
# image would otherwise change the build with no commit in between.
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
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
FROM nginx:1-alpine-slim@sha256:f45171d36c76a8b2f5ef97108a3a8a2294248a6578a0a180edc2d78f7d2edc26
RUN apk upgrade --no-cache
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/web.nginx.prod.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
