class AppError extends Error {
  constructor(code, message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code || 'INTERNAL_ERROR';
    this.statusCode = Number.isInteger(statusCode) ? statusCode : 500;
    this.details = details && typeof details === 'object' ? details : {};
    Error.captureStackTrace?.(this, AppError);
  }
}

function toPublicError(error) {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        success: false,
        code: error.code,
        message: error.message,
        details: error.details || {}
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      success: false,
      code: error?.code || 'INTERNAL_ERROR',
      message: error?.message || 'Internal server error.',
      details: error?.details || {}
    }
  };
}

module.exports = {
  AppError,
  toPublicError
};
