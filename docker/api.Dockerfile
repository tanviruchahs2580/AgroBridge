# ---- build stage: full toolchain (dev deps) for compile + prisma client ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/prisma ./apps/api/prisma
RUN npm ci --workspace apps/api
COPY apps/api/ ./apps/api/
WORKDIR /app/apps/api
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
RUN npx prisma generate
RUN npm run build

# ---- runtime stage: production deps only, freshest patches ----
FROM node:22-alpine
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
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/server.js"]
