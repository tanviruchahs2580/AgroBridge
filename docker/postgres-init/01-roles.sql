-- Two-role split for the compose database: the owner role (POSTGRES_USER, which
-- created the database and runs migrations) and the app role, which can only
-- read/write data. An application credential that cannot DDL turns a SQL
-- injection from "schema rewrite" into "data write", and lets a migration be
-- recognised by privilege instead of by convention.
--
-- Runs once, on the first start with an empty pgdata volume. To apply changes
-- to an existing dev volume, recreate it (`docker compose down -v`) or run the
-- ALTER statements by hand — the entrypoint does not rerun this file.
--
-- The app role's password is opt-in: set POSTGRES_APP_PASSWORD in .env before
-- the first start (`POSTGRES_APP_PASSWORD=... docker compose up -d db`). Without
-- it the role is created without LOGIN instead of with an invented default:
-- a passwordless LOGIN role that scram would reject anyway, and a committed
-- default password is exactly the placeholder habit .env.example warns about.
\getenv app_password POSTGRES_APP_PASSWORD
\if :{?app_password}
\else
\set app_password ''
\endif

SELECT set_config('agrobridge.app_password', :'app_password', false);

DO $$
DECLARE
  pw text := coalesce(current_setting('agrobridge.app_password', true), '');
BEGIN
  IF pw = '' THEN
    CREATE ROLE agrobridge_app;
    RAISE NOTICE 'agrobridge_app created WITHOUT LOGIN: set POSTGRES_APP_PASSWORD and recreate the volume to enable it';
  ELSE
    EXECUTE format('CREATE ROLE agrobridge_app LOGIN PASSWORD %L', pw);
  END IF;
END
$$;

SELECT set_config('agrobridge.app_password', '', false);

-- Hard database name: docker-compose.yml pins POSTGRES_DB to agrobridge.
GRANT CONNECT ON DATABASE agrobridge TO agrobridge_app;

GRANT USAGE ON SCHEMA public TO agrobridge_app;
-- No DDL for the app role: create privileges on schema public are never granted
-- and this revoke makes the intent explicit for reviewers reading pg_roles.
REVOKE CREATE ON SCHEMA public FROM agrobridge_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Existing objects (nothing on a fresh volume; kept so the file is also correct
-- if it is ever run against a populated database).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agrobridge_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agrobridge_app;

-- The load-bearing part: migrations keep running as the owner role
-- (`prisma migrate deploy` with the owner/pooled-direct URL), and every table
-- they create later must be reachable by the app role without another manual
-- GRANT. ALTER DEFAULT PRIVILEGES without FOR ROLE applies to the role running
-- this script — the owner POSTGRES_USER.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agrobridge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO agrobridge_app;
