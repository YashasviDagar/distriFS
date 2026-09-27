export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  NODE_UNAVAILABLE: "NODE_UNAVAILABLE",
  INTEGRITY_ERROR: "INTEGRITY_ERROR",
  INSUFFICIENT_STORAGE: "INSUFFICIENT_STORAGE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(ErrorCodes.VALIDATION_ERROR, message, 400, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(ErrorCodes.UNAUTHORIZED, message, 401);

export const forbidden = (message = "Access denied") =>
  new AppError(ErrorCodes.FORBIDDEN, message, 403);

export const notFound = (message = "Resource not found") =>
  new AppError(ErrorCodes.NOT_FOUND, message, 404);

export const conflict = (message: string, details?: unknown) =>
  new AppError(ErrorCodes.CONFLICT, message, 409, details);

export const payloadTooLarge = (message = "Payload too large") =>
  new AppError(ErrorCodes.PAYLOAD_TOO_LARGE, message, 413);

export const nodeUnavailable = (message = "Storage node unavailable") =>
  new AppError(ErrorCodes.NODE_UNAVAILABLE, message, 503);

export const integrityError = (message = "Data integrity check failed", details?: unknown) =>
  new AppError(ErrorCodes.INTEGRITY_ERROR, message, 500, details);

export const insufficientStorage = (message = "Insufficient storage capacity") =>
  new AppError(ErrorCodes.INSUFFICIENT_STORAGE, message, 507);
