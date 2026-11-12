// Typed errors for business rules. Entry points turn these into form
// messages or HTTP responses. Anything that is not a DomainError is an
// unexpected bug: log it and show a generic message.

export type DomainErrorCode =
  | "validation"
  | "not_found"
  | "conflict"
  | "forbidden"
  | "rule_violation";

const HTTP_STATUS: Record<DomainErrorCode, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rule_violation: 422,
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  /** Safe to show to staff. Never put internal details here. */
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: DomainErrorCode,
    userMessage: string,
    details?: Record<string, unknown>,
  ) {
    super(userMessage);
    this.name = "DomainError";
    this.code = code;
    this.userMessage = userMessage;
    this.details = details;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export class ValidationError extends DomainError {
  constructor(userMessage: string, details?: Record<string, unknown>) {
    super("validation", userMessage, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super("not_found", `${entity} not found.`, id ? { id } : undefined);
    this.name = "NotFoundError";
  }
}

/** Something changed underneath us, e.g. the slot was just booked. */
export class ConflictError extends DomainError {
  constructor(userMessage: string, details?: Record<string, unknown>) {
    super("conflict", userMessage, details);
    this.name = "ConflictError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(userMessage = "You do not have permission to do this.") {
    super("forbidden", userMessage);
    this.name = "ForbiddenError";
  }
}

/** A pack or clinic rule blocked the action, e.g. surgery without bloodwork. */
export class RuleViolationError extends DomainError {
  readonly ruleId: string;

  constructor(ruleId: string, userMessage: string, details?: Record<string, unknown>) {
    super("rule_violation", userMessage, { ruleId, ...details });
    this.name = "RuleViolationError";
    this.ruleId = ruleId;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
