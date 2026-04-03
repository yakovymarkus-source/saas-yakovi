function requireUserId(value, context = "unknown_context") {
  if (value === undefined || value === null || value === "") {
    const error = new Error(`Missing required userId in ${context}`);
    error.code = "MISSING_USER_ID";
    error.status = 401;
    throw error;
  }

  if (typeof value !== "string") {
    const error = new Error(`Invalid userId type in ${context}`);
    error.code = "INVALID_USER_ID";
    error.status = 400;
    throw error;
  }

  return value.trim();
}

module.exports = { requireUserId };
