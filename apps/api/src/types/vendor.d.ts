/**
 * Builder-neutral type bindings for two vendored middlewares.
 *
 * helmet and express-rate-limit ship dual CJS/ESM types; serverless builders
 * (@vercel/node) recompile this program with module settings different from the
 * repo's NodeNext build, where the default-import binding resolves as a
 * non-callable namespace. These declarations pin a stable callable shape that
 * typechecks under every module mode we build with. Runtime is unchanged: both
 * packages really do export a single default function.
 */
import type { RequestHandler } from "express";

declare module "helmet" {
  interface HelmetOptions {
    [option: string]: unknown;
  }
  const helmet: (options?: HelmetOptions) => RequestHandler;
  export default helmet;
}

declare module "express-rate-limit" {
  interface RateLimitOptions {
    windowMs?: number;
    limit?: number | ((req: unknown, res: unknown) => number);
    standardHeaders?: boolean | string;
    legacyHeaders?: boolean;
    skip?: (req: unknown, res: unknown) => boolean;
    store?: unknown;
    message?: unknown;
  }
  const rateLimit: (options?: RateLimitOptions) => RequestHandler;
  export default rateLimit;
}
