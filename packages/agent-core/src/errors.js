export class AgentError extends Error {
  constructor(message, { code = "agent_error", cause, details } = {}) {
    super(message, { cause });
    this.name = "AgentError";
    this.code = code;
    this.details = details;
  }
}

export class ApiError extends AgentError {
  constructor(message, { status = 0, code = "api_error", cause, details } = {}) {
    super(message, { code, cause, details });
    this.name = "ApiError";
    this.status = status;
  }
}

export class SafetyError extends AgentError {
  constructor(message, { code = "safety_error", cause, details } = {}) {
    super(message, { code, cause, details });
    this.name = "SafetyError";
  }
}
