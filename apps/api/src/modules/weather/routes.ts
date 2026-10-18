import { Router } from "express";
import { z } from "zod";
import { getWeatherProvider, deriveAgriRisks } from "../../providers/weather/index.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ok } from "../../middleware/context.js";

export const weatherRouter = Router();
weatherRouter.use(requireAuth);

weatherRouter.get(
  "/",
  validate({ query: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), cropStage: z.string().optional() }) }),
  async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    try {
      const { lat, lng, cropStage } = req.query as unknown as { lat: number; lng: number; cropStage?: string };
      const provider = getWeatherProvider();
      const [current, forecast] = await Promise.all([
        provider.getCurrent(lat, lng),
        provider.getForecast(lat, lng, 3),
      ]);
      const risks = deriveAgriRisks(current, forecast, cropStage);
      ok(res, {
        provider: provider.name,
        current,
        forecast,
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
