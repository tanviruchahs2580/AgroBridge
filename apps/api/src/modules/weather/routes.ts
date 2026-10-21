import { Router } from "express";
import { z } from "zod";
import { getWeatherProvider, deriveAgriRisks } from "../../providers/weather/index.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ok } from "../../middleware/context.js";
import { getOrLoadWeather } from "./cache.js";

export const weatherRouter = Router();
weatherRouter.use(requireAuth);

weatherRouter.get(
  "/",
  validate({ query: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), cropStage: z.string().optional() }) }),
  async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    try {
      const { lat, lng, cropStage } = req.query as unknown as { lat: number; lng: number; cropStage?: string };
      const provider = getWeatherProvider();

      // Cache hits reuse the ORIGINAL successful payload and its fetch time.
      // A provider failure takes the `catch` path below and is NEVER served
      // from a cache entry: an outage must surface as an honest error, not as
      // stale "current" weather presented as fresh (A5-05 / AUD-126). Risks
      // are re-derived per request because they depend on the caller's
      // cropStage, which is not part of the cached payload.
      //
      // Loading goes through the single-flight helper (F-07): concurrent requests
      // for a location that is not cached yet await one provider fetch instead of
      // each issuing their own. `cached` reports a stored-entry reuse only — a
      // request that shared an in-flight fetch received that same fresh payload,
      // so claiming a cache hit for it would misreport its age.
      const { payload, cached } = await getOrLoadWeather(lat, lng, async () => {
        const [current, forecast] = await Promise.all([
          provider.getCurrent(lat, lng),
          provider.getForecast(lat, lng, 3),
        ]);
        return { current, forecast, fetchedAt: Date.now() };
      });

      // Provenance envelope (AUD-126 / A5-01): where the data came from, when
      // it was fetched from the provider, the provider's own observation time
      // (when reported), and whether this response was a cache reuse.
      const current = { ...payload.current, source: payload.current.source ?? provider.name };
      const risks = deriveAgriRisks(current, payload.forecast, cropStage);
      ok(res, {
        provider: provider.name,
        source: provider.name,
        fetchedAt: new Date(payload.fetchedAt).toISOString(),
        cached,
        current,
        forecast: payload.forecast,
        risks,
      });
    } catch (e) {
      // Provider failures currently surface as a generic server error (the
      // adapter throws plain Errors) — never a fake forecast. Mapping them to
      // an explicit 502/503 is tracked as a deferred improvement (AUD-117).
      next(e);
    }
  }
);
