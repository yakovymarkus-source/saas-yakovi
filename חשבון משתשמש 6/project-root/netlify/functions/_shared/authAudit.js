const { logger } = require('./logger');

function buildAuthLog({ action, userId = null, email = null, requestId = null, traceId = null, ip = 'unknown', outcome, reason = null }) {
  return {
    action,
    user_id: userId,
    email,
    request_id: requestId,
    trace_id: traceId || requestId,
    ip,
    outcome,
    reason
  };
}

function logAuthAttempt(context) {
  logger.info(`${context.action} attempt`, buildAuthLog({ ...context, outcome: 'attempt' }));
}

function logAuthSuccess(context) {
  logger.info(`${context.action} success`, buildAuthLog({ ...context, outcome: 'success' }));
}

function logAuthFailure(context) {
  logger.warn(`${context.action} failure`, buildAuthLog({ ...context, outcome: 'failure' }));
}

module.exports = {
  buildAuthLog,
  logAuthAttempt,
  logAuthSuccess,
  logAuthFailure
};
