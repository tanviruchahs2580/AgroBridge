/**
 * Vercel serverless entry. The long-running server lives in src/server.ts and
 * is compiled by the repo-owned build (vercel.json → tsc -p tsconfig.build.json);
 * this adapter builds the compiled Express app so @vercel/node serves each
 * Function invocation through it (docs/deployment.md — Vercel topology).
 */
import { createApp } from "../dist/app.js";

const app = createApp();

export default app;
