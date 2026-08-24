import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export interface AccessPayload {
  sub: string;
  role: string;
}

export function signAccessToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: "agrobridge",
  } as jwt.SignOptions);
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(unauthorized());
  let payload: AccessPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { issuer: "agrobridge" }) as AccessPayload;
  } catch {
    return next(unauthorized("Invalid or expired access token"));
  }

  // Immediate revocation semantics: suspended/deleted users are rejected even
  // if their short-lived access token has not expired yet.
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { status: true, role: true } });
    if (!user || user.status !== "ACTIVE") return next(unauthorized("Account is not active"));
    req.auth = { userId: payload.sub, role: user.role };
    return next();
  } catch (e) {
    return next(e);
  }
}
