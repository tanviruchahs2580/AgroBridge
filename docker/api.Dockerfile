# AgroBridge API — multi-stage production build
FROM node:22-alpine AS build
WORKDIR /app

# Install workspace deps deterministically (root manifests first for layer cache)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @agrobridge/api --include-workspace-root --no-audit --no-fund

COPY apps/api apps/api
# Production image must use the PostgreSQL-flavoured client.
# For dev/test the sqlite schema (schema.prisma) is used via `npm run test`.
# Generate PG client BEFORE build so tsc can resolve Prisma types (needs DATABASE_URL dummy).
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate --schema apps/api/prisma/schema.postgresql.prisma \
 && cp apps/api/prisma/schema.postgresql.prisma apps/api/prisma/schema.prisma \
 && npm run build --workspace @agrobridge/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

USER app
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

# Migrations are applied via `npx prisma migrate deploy` before start (see docker-compose / deployment docs).
CMD ["node", "dist/server.js"]
