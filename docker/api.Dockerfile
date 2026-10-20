# ---- build stage: full toolchain (dev deps) for compile + prisma client ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY scripts/generate-prisma.mjs ./scripts/generate-prisma.mjs
RUN npm ci --workspace apps/api
COPY apps/api/ ./apps/api/
WORKDIR /app/apps/api
# Generate from the schema the migration chain actually applies
# (prisma/postgres/schema.prisma) instead of a sed-rewritten copy of the SQLite
# dev schema (F-10). The two were equivalent when audited — only binaryTargets
# and one index's position differed — but the shipped client and the shipped
# migrations were built from two files that nothing compared, and no gate would
# have caught them drifting apart.
RUN npx prisma generate --schema prisma/postgres/schema.prisma
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
# Named paths, never the whole prisma directory (F-01): a developer's working copy
# of apps/api/prisma also holds dev.db / test.db / audit-*.db, and a
# whole-directory COPY shipped 23 of them — password and refresh-token hashes
# included — inside the production artifact. `.dockerignore` excludes them too;
# this is the inner of the two guards, so a stray database added tomorrow cannot
# ride along even if the ignore file is missed.
COPY --from=build /app/apps/api/prisma/schema.prisma ./apps/api/prisma/schema.prisma
COPY --from=build /app/apps/api/prisma/postgres ./apps/api/prisma/postgres
COPY --from=build /app/apps/api/prisma/migrations ./apps/api/prisma/migrations
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
