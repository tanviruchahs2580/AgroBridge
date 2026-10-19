import type { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import { badRequest } from "../shared/errors/index.js";

type Part = "body" | "query" | "params";

export function validate(schemas: Partial<Record<Part, ZodSchema>>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      for (const part of Object.keys(schemas) as Part[]) {
        const schema = schemas[part];
        // Object.keys only yields keys the caller supplied; the guard states that
        // for the compiler without a non-null assertion.
        if (!schema) continue;
        const result = schema.safeParse(req[part]);
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
