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
  async (req, res, next) => {
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
      // Provider failures degrade gracefully — never a raw 500 to farmers.
      next(e);
    }
  }
);
