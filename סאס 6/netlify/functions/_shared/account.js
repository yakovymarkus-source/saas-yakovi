const { getAdminClient } = require('./supabase');
const { AppError } = require('./errors');

function resolveUserId(userOrId) {
  if (typeof userOrId === 'string') return userOrId;
  if (userOrId && typeof userOrId === 'object' && typeof userOrId.id === 'string') return userOrId.id;
  throw new AppError({ code: 'INVALID_ACCOUNT_INPUT', userMessage: 'נתוני משתמש לא תקינים', devMessage: 'Missing or invalid user identifier', status: 400 });
}

function sanitizeProfile(profile, userId) {
  const source = profile && typeof profile === 'object' ? profile : {};
  return {
    id: source.id || userId,
    email: typeof source.email === 'string' ? source.email : null,
    name: typeof source.name === 'string' ? source.name : null,
    deleted: Boolean(source.deleted),
  };
}

async function getProfile(userOrId) {
  const userId = resolveUserId(userOrId);
  const client = getAdminClient();
  if (typeof client.getProfile === 'function') {
    const result = await client.getProfile(userId);
    return sanitizeProfile(result, userId);
  }

  if (typeof client.from === 'function') {
    const response = await client.from('profiles').select('id,email,name').eq('id', userId).maybeSingle();
    if (response?.error) {
      throw new AppError({ code: 'DB_READ_FAILED', userMessage: 'טעינת הפרופיל נכשלה', devMessage: response.error.message, status: 500, details: { userId } });
    }
    return sanitizeProfile(response?.data, userId);
  }

  return sanitizeProfile({ id: userId }, userId);
}

async function updateProfile(userOrId, updates) {
  const userId = resolveUserId(userOrId);
  if (updates == null || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new AppError({ code: 'INVALID_ACCOUNT_INPUT', userMessage: 'נתוני העדכון לא תקינים', devMessage: 'Profile updates must be an object', status: 400, details: { userId } });
  }

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
    patch.email = typeof updates.email === 'string' && updates.email.trim() ? updates.email.trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
    patch.name = typeof updates.name === 'string' && updates.name.trim() ? updates.name.trim() : null;
  }

  const client = getAdminClient();
  if (typeof client.updateProfile === 'function') {
    const result = await client.updateProfile(userId, patch);
    return sanitizeProfile(result, userId);
  }

  if (typeof client.from === 'function' && Object.keys(patch).length > 0) {
    const response = await client.from('profiles').update(patch).eq('id', userId).select('id,email,name').maybeSingle();
    if (response?.error) {
      throw new AppError({ code: 'DB_WRITE_FAILED', userMessage: 'עדכון הפרופיל נכשל', devMessage: response.error.message, status: 500, details: { userId } });
    }
    return sanitizeProfile(response?.data, userId);
  }

  return sanitizeProfile({ id: userId, ...patch }, userId);
}

async function softDeleteAccount(userOrId) {
  const userId = resolveUserId(userOrId);
  const client = getAdminClient();
  if (typeof client.softDeleteAccount === 'function') {
    const result = await client.softDeleteAccount(userId);
    return sanitizeProfile({ ...result, id: userId, deleted: true }, userId);
  }
  return sanitizeProfile({ id: userId, deleted: true }, userId);
}

module.exports = { getProfile, updateProfile, softDeleteAccount };
