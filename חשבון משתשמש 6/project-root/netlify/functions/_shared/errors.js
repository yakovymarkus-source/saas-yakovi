class AppError extends Error {
  constructor(code, message, statusCode = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized.') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please try again later.', details = null) {
    super('RATE_LIMITED', message, 429, details);
    this.name = 'RateLimitError';
  }
}

module.exports = {
  AppError,
  UnauthorizedError,
  RateLimitError
};
