import type { Request } from "express";
import { unauthorized } from "./errors/index.js";

/**
 * The authenticated context `requireAuth` attaches, or a 401.
 *
 * Replaces `req.auth!` non-null assertions: the compiler cannot see the
 * middleware ordering, so a route that somehow reaches its handler without
 * `requireAuth` previously threw a TypeError (500) at the first property
 * access; this returns the same unauthorized() every other auth failure does.
 */
export function getAuth(req: Request): { userId: string; role: string } {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
