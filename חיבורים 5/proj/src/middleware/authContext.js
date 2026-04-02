const { requireUserId } = require("../lib/requireUserId");

function extractUserIdFromRequest(req) {
  return requireUserId(
    (req.user && req.user.id) ||
      (req.auth && req.auth.userId) ||
      (req.session && req.session.userId) ||
      req.headers["x-user-id"],
    "authContext"
  );
}

function authContext(req, _res, next) {
  try {
    req.userId = extractUserIdFromRequest(req);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { authContext, extractUserIdFromRequest };
