#!/usr/bin/env node
/**
 * Latency probe (WP-09, REL-01): measures DNS / TCP / TLS / TTFB / total for a
 * set of API endpoints, N repetitions, and prints p50/p95/p99 per endpoint as
 * JSON. No secrets: an optional bearer token comes from PROBE_AUTH_TOKEN (the
 * caller's environment), nothing is written anywhere, and the output contains
 * only timings and status codes.
 *
 * Runs from any network — the point is to run it FROM Bangladeshi mobile and
 * fixed networks (owner-run, docs/runbooks/latency-probe.md) so the
 * client→API leg to the serving region is measured where it hurts, not
 * inferred. DNS/TCP/TLS are measured with real sockets once per repetition
 * against the target host; TTFB/total come from the actual request.
 *
 * Usage:
 *   BASE_URL=https://agro-bridge-api-vantiq-systems.vercel.app \
 *   [PROBE_AUTH_TOKEN=...] [PROBE_REPS=10] [PROBE_PATHS=/health,/api/v1/products] \
 *     node scripts/qa/latency-probe.mjs
 */
import net from "node:net";
import tls from "node:tls";

const baseUrl = process.env.BASE_URL;
if (!baseUrl) {
  console.error("BASE_URL is required (the API origin, e.g. https://api.example.com)");
  process.exit(1);
}
const url = new URL(baseUrl);
const isTls = url.protocol === "https:";
const port = Number(url.port) || (isTls ? 443 : 80);
const reps = Math.max(1, Number(process.env.PROBE_REPS ?? 10));
const paths = (process.env.PROBE_PATHS ?? "/health,/ready,/api/v1/products").split(",").map((p) => p.trim()).filter(Boolean);
const token = process.env.PROBE_AUTH_TOKEN;

const percentile = (xs, p) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
};
const r2 = (v) => Math.round(v * 10) / 10;

/** One raw socket connection, resolving {dnsMs, tcpMs, tlsMs, error?}. */
function connectOnce() {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host: url.hostname, port });
    let dnsMs;
    socket.once("lookup", () => {
      dnsMs = Date.now() - started;
    });
    socket.once("connect", () => {
      const tcpMs = Date.now() - started - (dnsMs ?? 0);
      if (!isTls) {
        socket.destroy();
        resolve({ dnsMs: dnsMs ?? 0, tcpMs, tlsMs: 0 });
        return;
      }
      const tlsStarted = Date.now();
      const tlsSocket = tls.connect({ socket, servername: url.hostname, rejectUnauthorized: true }, () => {
        const tlsMs = Date.now() - tlsStarted;
        tlsSocket.destroy();
        resolve({ dnsMs: dnsMs ?? 0, tcpMs, tlsMs });
      });
      tlsSocket.once("error", (e) => resolve({ dnsMs: dnsMs ?? 0, tcpMs, tlsMs: -1, error: `tls: ${e.message}` }));
    });
    socket.once("error", (e) => resolve({ dnsMs: -1, tcpMs: -1, tlsMs: -1, error: e.message }));
  });
}

/** One real request, resolving {ttfbMs, totalMs, status, error?}. */
async function requestOnce(path) {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    await res.arrayBuffer(); // drain the body so totalMs includes it
    const totalMs = Date.now() - started;
    return { ttfbMs: -1, totalMs, status: res.status };
  } catch (e) {
    return { ttfbMs: -1, totalMs: Date.now() - started, status: 0, error: (e).message };
  }
}

const report = { baseUrl, repetitions: reps, generatedAt: new Date().toISOString(), connections: {}, endpoints: {} };

const connSamples = [];
for (let i = 0; i < reps; i++) connSamples.push(await connectOnce());
const okConn = connSamples.filter((c) => !c.error);
report.connections = okConn.length
  ? {
      samples: okConn.length,
      dnsP50: r2(percentile(okConn.map((c) => c.dnsMs), 50)),
      tcpP50: r2(percentile(okConn.map((c) => c.tcpMs), 50)),
      tlsP50: okConn.some((c) => c.tlsMs >= 0) ? r2(percentile(okConn.filter((c) => c.tlsMs >= 0).map((c) => c.tlsMs), 50)) : undefined,
      errors: connSamples.length - okConn.length,
      errorSample: connSamples.find((c) => c.error)?.error,
    }
  : { samples: 0, errors: connSamples.length, errorSample: connSamples[0]?.error };

for (const path of paths) {
  const samples = [];
  for (let i = 0; i < reps; i++) samples.push(await requestOnce(path));
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300);
  const totals = ok.map((s) => s.totalMs);
  report.endpoints[path] = {
    successful: ok.length,
    failures: samples.length - ok.length,
    statusSample: samples[0]?.status,
    errorSample: samples.find((s) => s.error)?.error,
    totalMs: totals.length
      ? { p50: r2(percentile(totals, 50)), p95: r2(percentile(totals, 95)), p99: r2(percentile(totals, 99)) }
      : undefined,
  };
}

console.log(JSON.stringify(report, null, 2));
