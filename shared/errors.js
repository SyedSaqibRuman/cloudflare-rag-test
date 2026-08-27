// --------------------------
// SHARED — Typed error classes for the application layer.
// Services and domain logic throw these instead of generic Error, so route
// handlers and middleware can map them to the correct HTTP status code and
// machine-readable error code. The `status` property is backward-compatible
// with the existing ad-hoc `err.status = 404` pattern in mysql/routes/.
//
// Usage:
//   import { NotFoundError, ValidationError } from "../../shared/errors.js";
//   throw new NotFoundError("Company 'acme' not found");
//   throw new ValidationError("Model key must match /^[a-z0-9_]+$/");
//
// The errorHandler middleware (app.js) and the wrap() helper (mysql/routes/)
// both recognize these classes and extract the status + code automatically.
// --------------------------

/**
 * Base application error. All typed errors extend this.
 * @property {number}   status       HTTP status code (default 500)
 * @property {string|null} code      Machine-readable code (e.g. "COMPANY_NOT_FOUND")
 * @property {boolean}  isOperational  True for expected business errors; false for
 *   programming bugs (the default errorHandler only leaks the message for
 *   operational errors; stack traces are logged server-side regardless).
 */
export class AppError extends Error {
  /** @param {string} message  Human-readable error message.
   *  @param {number} [status=500]  HTTP status code.
   *  @param {string|null} [code=null]  Machine-readable error code.
   */
  constructor(message, status = 500, code = null) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.isOperational = true;
  }
}

/** 400 — malformed request body, missing required fields, invalid input. */
export class ValidationError extends AppError {
  constructor(message, code = "VALIDATION_ERROR") {
    super(message, 400, code);
  }
}

/** 400 with per-field error map (e.g. { providerKey: "required" }). */
export class ValidationErrorMap extends ValidationError {
  /**
   * @param {Record<string, string>} errors  Field → message map.
   */
  constructor(errors) {
    super("Validation failed", "VALIDATION_ERROR");
    this.errors = errors;
  }
}

/** 401 — missing or invalid authentication credential. */
export class AuthenticationError extends AppError {
  constructor(message = "Authentication required.", code = "AUTHENTICATION_ERROR") {
    super(message, 401, code);
  }
}

/** 403 — authenticated but not authorized for this action. */
export class AuthorizationError extends AppError {
  constructor(message = "Insufficient permissions.", code = "AUTHORIZATION_ERROR") {
    super(message, 403, code);
  }
}

/** 404 — requested entity does not exist. */
export class NotFoundError extends AppError {
  constructor(message, code = "NOT_FOUND") {
    super(message, 404, code);
  }
}

/** 409 — entity already exists or conflicts with current state. */
export class ConflictError extends AppError {
  constructor(message, code = "CONFLICT") {
    super(message, 409, code);
  }
}

/** 429 — rate limit exceeded. */
export class RateLimitError extends AppError {
  constructor(message = "Rate limit exceeded. Please try again later.", code = "RATE_LIMIT") {
    super(message, 429, code);
  }
}

/** 502 — upstream / external service returned an error. */
export class ExternalServiceError extends AppError {
  /**
   * @param {string} message  Describes the upstream failure.
   *  @param {string|null} [service=null]  Name of the failing service.
   */
  constructor(message, service = null) {
    super(message, 502, "EXTERNAL_SERVICE_ERROR");
    this.service = service;
  }
}

/** 503 — service temporarily unavailable (e.g. MySQL not configured). */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable.", code = "SERVICE_UNAVAILABLE") {
    super(message, 503, code);
  }
}

/**
 * Check whether an error is an operational AppError (safe to expose the
 * message to the client) vs. a programming bug (should only log, not leak).
 * @param {unknown} err
 * @returns {err is AppError}
 */
export function isAppError(err) {
  return err instanceof AppError;
}
