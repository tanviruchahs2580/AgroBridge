FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
# --include-workspace-root: root devDeps (prisma) must be present for the root
# postinstall hook (prisma generate) — CI api-quality uses the same pattern.
RUN npm ci --workspace apps/web --include-workspace-root
COPY . .
WORKDIR /app/apps/web
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build
# ---- runtime stage: minimal, patched nginx (fixes 4 HIGH in nginx:alpine's
# util-linux/libxml2 via the slimmer base + apk upgrade) ----
FROM nginx:1-alpine-slim
RUN apk upgrade --no-cache
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/web.nginx.prod.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
