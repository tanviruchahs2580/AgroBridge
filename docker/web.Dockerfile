# AgroBridge Web — static SPA served by nginx
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @agrobridge/web --include-workspace-root --no-audit --no-fund

COPY apps/web apps/web
ARG VITE_API_BASE=/api/v1
RUN npm run build --workspace @agrobridge/web

FROM nginx:1.27-alpine AS runtime
COPY docker/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost/ || exit 1
