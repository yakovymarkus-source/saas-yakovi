const API_SECRET = process.env.API_SECRET;

function apiKeyAuth(req, res, next) {
  if (!API_SECRET) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header', code: 'UNAUTHORIZED' });
  }

  const token = authHeader.slice(7);
  if (token !== API_SECRET) {
    return res.status(401).json({ error: 'Invalid API key', code: 'UNAUTHORIZED' });
  }

  next();
}

module.exports = { apiKeyAuth };
