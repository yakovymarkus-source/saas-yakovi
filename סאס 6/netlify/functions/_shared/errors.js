class AppError extends Error {
  constructor({ code = 'INTERNAL_ERROR', userMessage = 'שגיאה פנימית', devMessage = 'Internal error', status = 500, details = {} } = {}) {
    super(devMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.devMessage = devMessage;
    this.status = status;
    this.details = details;
  }
}

function toAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError({
    code: 'INTERNAL_ERROR',
    userMessage: 'שגיאה פנימית',
    devMessage: error?.message || 'Internal error',
    status: 500,
  });
}

module.exports = { AppError, toAppError };
