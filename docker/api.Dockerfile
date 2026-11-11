# ---- build stage: full toolchain (dev deps) for compile + prisma client ----
# Base images are digest-pinned (tag kept in the reference for humans): a
# retagged `node:22-alpine` would otherwise change what we build and ship with
# no commit in between. node:22-alpine
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS build
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
# node:22-alpine (same digest as the build stage)
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS runtime
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
# The ops module's scheduled reconciliation imports the production script
# (dist/modules/ops/routes.js -> apps/api/scripts/reconcile-wallet.mjs), so the
# file must ship with dist or the API crashes at module load and /health never
# answers — which is exactly how the compose smoke failed on 2026-11-11.
COPY --from=build /app/apps/api/scripts/reconcile-wallet.mjs ./apps/api/scripts/reconcile-wallet.mjs
# No npm/npx and no Prisma CLI in the shipped runtime image — a deliberate
# choice, and the reason migrations are a separate step: schema changes run from
# the `migrate` stage below (docker-compose.prod.yml service `migrate`, profile
# `migrate`), never from this container and never on boot.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app/apps/api
# Run as the unprivileged `node` user shipped with the base image (Phase 13:
# no root containers). uploads/ is pre-created writable for local-storage mode.
RUN mkdir -p /app/apps/api/uploads/disease && chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]

# ---- migration stage: the Prisma CLI, not a server ----
# The runtime stage above ships neither npm/npx nor the Prisma CLI, so the
# documented `docker compose exec api npx prisma migrate deploy` could never
# have run (F-18). Schema changes run from this stage in their own one-shot
# container instead of widening the runtime image:
#
#   docker build --target migrate -f docker/api.Dockerfile -t <ns>/api-migrate:<tag> .
#   docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
#
# The deploy workflow builds it with the same tags as the api image and runs it
# BEFORE `up -d`, so "apply schema" and "deploy code" stay two separately
# observable, separately reversible steps. `migrate deploy` is idempotent and
# append-only: it is safe to re-run, and rolling the application back does not
# roll the schema back.
FROM build AS migrate
WORKDIR /app/apps/api
ENV NODE_ENV=production
# Read + execute only: the Prisma engine binaries are present from `npm ci` in
# the build stage, and this container only talks to the database.
USER node
ENTRYPOINT ["sh", "-c", "exec npx prisma migrate deploy --schema prisma/postgres/schema.prisma"]
