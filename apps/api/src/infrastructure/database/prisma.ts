import { PrismaClient } from "@prisma/client";
import { env, isProd } from "../../config/env.js";

declare global {
   
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (!isProd) global.__prisma = prisma;
