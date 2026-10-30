// AI-06 acceptance drill: provider failure (500s, then a hang past the adapter
// timeout) must trigger the documented fallback — and the answer must not
// pretend a live model answered.
//
// Run: node apps/web/e2e/probe-ai-fallback.mjs
import { createServer } from "node:http";
import { freshDb, provision, startApi, waitHealthy, json, loginOn } from "./probe-helpers.mjs";

const STUB_PORT = 4291;
const API_PORT = 4200;
let mode = "500"; // "500" | "hang"

const stub = createServer((req, res) => {
  if (mode === "hang") return; // never answers: the adapter must time out
  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "stub upstream boom" } }));
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

const dbUrl = freshDb("drill-ai-fallback");
provision(dbUrl);
const api = startApi(API_PORT, dbUrl, {
  AI_PROVIDER: "openai-compatible",
  OPENAI_API_KEY: "drill-test-key",
  OPENAI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
  OPENAI_MODEL: "stub-model",
});
await waitHealthy(API_PORT);
const session = await loginOn(API_PORT);

const results = {};
for (const m of ["500", "hang"]) {
  mode = m;
  const t0 = Date.now();
  const r = await json("POST", API_PORT, "/api/v1/ai/advisory", {
    token: session.accessToken,
    body: { question: "ধানে ব্লাস্ট রোগ হলে কী করব?", lang: "bn" },
  });
  results[m] = {
    status: r.status,
    ms: Date.now() - t0,
    provider: r.data?.data?.provider ?? null,
    hasAnswer: Boolean(r.data?.data?.answer && r.data.data.answer.length > 10),
  };
}
await api.stop();
stub.close();

const pass =
  results["500"].status === 200 &&
  results["500"].provider === "offline-agro-engine" &&
  results["500"].hasAnswer &&
  results["hang"].status === 200 &&
  results["hang"].provider === "offline-agro-engine" &&
  results["hang"].hasAnswer;

console.log(JSON.stringify({ scenario: "AI-06", pass, results }, null, 2));
process.exit(pass ? 0 : 1);
