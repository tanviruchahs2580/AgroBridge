# Runbook — Quarterly Chaos Drills

Purpose: prove that recovery paths documented in [disaster-recovery](../disaster-recovery.md)
actually work, on the staging VM (never production). Cadence: **quarterly**, before the DR drill
in disaster-recovery.md. Record every run in the evidence table at the bottom.

## Drill 1 — DB kill

Simulates a crashed PostgreSQL container.

```bash
cd ~/agrobridge
docker compose -f docker-compose.prod.yml ps          # note start time
docker kill $(docker compose -f docker-compose.prod.yml ps -q db)
date +%s > /tmp/db-kill-start                          # T0
```

Measure:

1. `docker compose -f docker-compose.prod.yml ps` → db restarts (`restart: unless-stopped`).
2. Watch API recovery: `watch docker compose -f docker-compose.prod.yml exec api wget -qO- http://localhost:4000/ready`
   — expect `"db":true` again without restarting api.
3. Recovery time = time until first successful `/ready`. Target: **< 2 min**.
4. Verify data intact: log in as seeded admin, open one farmer journey.

Failure modes to check: `pgdata` volume still mounted; api reconnect logic (pool retries);
alert `DbDown` fired in monitoring within ~4 min.

## Drill 2 — Network partition (toxiproxy)

Simulates intermittent DB connectivity instead of a hard crash.

Compose fragment — add alongside `db`/`api` temporarily (do NOT commit):

```yaml
  toxiproxy:
    image: ghcr.io/shopify/toxiproxy:latest
    networks: [internal]
    command: ["-host", "0.0.0.0", "-port", "8474"]

  # point api's DATABASE_URL host at toxiproxy:15432 for the drill,
  # toxiproxy forwards to db:5432, then inject latency:
  #   docker exec <toxiproxy> toxiproxy-cli create psql
  #   docker exec <toxiproxy> toxiproxy-cli listen psql --upstream db:5432 --port 15432
  #   docker exec <toxiproxy> toxiproxy-cli toxic add psql -t latency -a latency=2000
```

Procedure:

1. Start toxiproxy with clean proxy `psql` → `db:5432`, repoint `API_DATABASE_URL`
   to `postgresql://...@toxiproxy:15432/agrobridge`, `up -d api`.
2. Confirm baseline `/ready` ok.
3. Inject `latency=2000` toxic → observe p95 latency alert threshold behaviour
   (`ApiHighLatencyP95`) and request timeouts.
4. Inject `timeout=0` / stop the proxy → expect `DbDown` alert and graceful error envelopes
   (not 500 stack traces) from `/api/v1`.
5. Remove toxic → confirm recovery without container restarts.
6. Restore original DATABASE_URL, `up -d api`.

## Drill 3 — Disk full simulation

Simulates uploads volume exhaustion (disease photos) and pgdata pressure.

```bash
# fill the uploads volume (bounded — do not fill the host root!)
docker compose -f docker-compose.prod.yml exec api sh -c \
  'dd if=/dev/zero of=/app/uploads/filler bs=1M count=900'
```

Expectations:

1. Photo upload endpoint returns a controlled error (not a crash); health stays green.
2. Remove filler: `rm /app/uploads/filler`.
3. Repeat conceptually against pgdata only in a throwaway copy — never on real data;
   document what monitoring would show (`node_filesystem_avail` if node exporter added,
   otherwise disk alerts are an infrastructure gap — note it in evidence).

## Checklist (every drill)

- [ ] Run on staging VM only; announce window to team beforehand
- [ ] Backup taken & restore-verified **before** starting (`npm run pg:rehearse-backup`)
- [ ] Monitoring dashboard + alerts visible during drill
- [ ] Timings captured (T0 → recovered) for each drill
- [ ] User-facing behaviour checked via app (not just curl): friendly errors, no data loss
- [ ] Rollback criteria evaluated (below)

## Evidence record

| Date | Drill | T0 | Recovered | RTO observed | Alerts fired | Issues found | Owner |
|---|---|---|---|---|---|---|---|
| | DB kill | | | | | | |
| | Network partition | | | | | | |
| | Disk full | | | | | | |

## Rollback criteria

Abort the drill and roll back immediately if any of these occur on staging:

1. Data loss detected after recovery (row counts differ from pre-drill baseline).
2. API fails to reach `/ready` green within **10 minutes** of the fault being removed.
3. Backups prove unrestorable during the pre-drill verification.
4. Cascading failures beyond the injected fault (web down, host degraded).

After each drill: file issues for gaps found, update this runbook, re-run only the failed
drill next quarter plus one rotation.
