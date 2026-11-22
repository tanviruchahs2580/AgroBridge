# Runbook — latency probe (REL-01, gate G6 prep)

`scripts/qa/latency-probe.mjs` measures DNS / TCP / TLS / TTFB / total latency for the API's
endpoints, N repetitions, and prints p50/p95/p99 per endpoint as JSON. It sends no secrets (an
optional bearer token comes from the caller's env), writes nothing, and works from any network.

## Why it exists

The API functions and the Neon primary are co-located in `iad1` (ADR-0018); the hop a Bangladeshi
farmer pays is **client → API**. Nothing in the repository can measure that leg — it must be
measured **from Bangladeshi networks**, which is an owner-run step (OA-12 feeds DR-11).

## How to run it — [owner], per network

```bash
# from a Bangladeshi mobile network (tether a laptop, or run on the phone's terminal)
BASE_URL=https://agro-bridge-api-vantiq-systems.vercel.app PROBE_REPS=20 \
  node scripts/qa/latency-probe.mjs > latency-mobile-<date>.json

# again on fixed broadband
BASE_URL=... PROBE_REPS=20 node scripts/qa/latency-probe.mjs > latency-fixed-<date>.json
```

- `PROBE_REPS=20` (default 10) gives steadier percentiles; run at two different times of day —
  evening congestion on mobile networks is real.
- **Git Bash on Windows** mangles leading-slash arguments into Windows paths (MSYS path
  conversion): prefix the command with `MSYS_NO_PATHCONV=1`, or the endpoint paths arrive as
  `C:/Program Files/Git/health` and every request fails URL parsing.
- Optional: `PROBE_PATHS=/health,/api/v1/products` to target specific reads;
  `PROBE_AUTH_TOKEN=<a throwaway demo token>` to measure an **authenticated** read (the p95 budget
  below is stated for authenticated reads — the extra DB round trip is part of the honest number;
  use the demo account, never a real farmer's session).
- Commit the JSON files under `qa-evidence/` and reference them in the DR-11 memo.

## How CI uses it

The probe is a plain script (no repo state, no secrets); a scheduled job can run it from a runner
to **trend** the serving region's response times, but a runner's vantage point is not Bangladesh —
runner numbers are trending evidence only, never the G6 measurement.

## Reading the output

- `connections.dnsP50/tcpP50/tlsP50` — the handshake cost; on mobile these dominate short requests.
- `endpoints["…"].totalMs.p50/p95/p99` — the end-to-end leg the SLO budget talks about.
- `failures` + `errorSample` — connection errors from a network are a finding (a tunnel or a
  firewall eating TLS), not a probe bug; re-run before concluding.

## The proposed budget (DR-11 input — the owner sets the number)

Proposal recorded in `docs/decisions/DR-11-region.md`: authenticated reads **p95 ≤ 600 ms** on 4G
from Dhaka. If the probe shows p95 far above that from every Bangladeshi network, the region
decision (stay `iad1` / move database first / move both) has real numbers to decide on.
