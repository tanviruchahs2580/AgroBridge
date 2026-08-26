export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Authentication required") => new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", msg);
export const notFound = (entity = "Resource") => new AppError(404, "NOT_FOUND", `${entity} not found`);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, "UNPROCESSABLE", msg, details);
export const tooMany = (msg = "Too many requests, please try again later") =>
  new AppError(429, "RATE_LIMITED", msg);
export const phoneNotVerified = () =>
  new AppError(403, "PHONE_NOT_VERIFIED", "Phone number must be verified before this action");
