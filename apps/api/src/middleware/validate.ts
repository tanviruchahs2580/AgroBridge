import type { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import { badRequest } from "../lib/errors.js";

type Part = "body" | "query" | "params";

export function validate(schemas: Partial<Record<Part, ZodSchema>>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      for (const part of Object.keys(schemas) as Part[]) {
        const result = schemas[part]!.safeParse(req[part]);
        if (!result.success) {
          return next(
            badRequest(
              `Invalid ${part}`,
              result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
            )
          );
        }
        // Assign parsed (coerced/trimmed) values back.
        (req as unknown as Record<Part, unknown>)[part] = result.data;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
