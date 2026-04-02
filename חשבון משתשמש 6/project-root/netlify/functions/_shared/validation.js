const { loadEnv } = require('./env');
const { AppError } = require('./errors');

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function requireEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!isEmail(email) || email.length > 120) {
    throw new AppError('INVALID_EMAIL', 'Email is invalid.', 400);
  }
  return email;
}

function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128) {
    throw new AppError('INVALID_PASSWORD', 'Password must be between 8 and 128 characters long.', 400);
  }
  if (!/[A-Z]/.test(password)) {
    throw new AppError('INVALID_PASSWORD', 'Password must include an uppercase letter.', 400);
  }
  if (!/[a-z]/.test(password)) {
    throw new AppError('INVALID_PASSWORD', 'Password must include a lowercase letter.', 400);
  }
  if (!/[0-9]/.test(password)) {
    throw new AppError('INVALID_PASSWORD', 'Password must include a number.', 400);
  }
  return password;
}

function validateName(value) {
  const name = String(value || '').trim();
  if (name.length < 2 || name.length > 80) {
    throw new AppError('INVALID_NAME', 'Full name must be between 2 and 80 characters.', 400);
  }
  return name;
}

function validateCurrentPassword(value) {
  const password = String(value || '');
  if (!password) {
    throw new AppError('CURRENT_PASSWORD_REQUIRED', 'Current password is required.', 400);
  }
  return password;
}

function validateDeleteConfirmation(value) {
  if (String(value || '').trim() !== 'מחק חשבון') {
    throw new AppError('INVALID_CONFIRMATION', 'Delete confirmation text is incorrect.', 400);
  }
}

function validateAvatarUrl(value, userId) {
  if (value === null || value === undefined || value === '') return null;
  const url = String(value).trim();
  if (url.length > 2048) {
    throw new AppError('INVALID_AVATAR', 'Avatar URL is too long.', 400);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw new AppError('INVALID_AVATAR', 'Avatar URL is invalid.', 400);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError('INVALID_AVATAR', 'Avatar URL protocol is invalid.', 400);
  }

  const env = loadEnv();
  const normalizedBase = env.supabaseUrl.replace(/\/$/, '');
  const allowedPrefix = `${normalizedBase}/storage/v1/object/public/avatars/${userId}/`;
  if (!url.startsWith(allowedPrefix)) {
    throw new AppError('INVALID_AVATAR', 'Avatar URL must point to the authenticated user folder.', 400);
  }

  return url;
}

module.exports = {
  isEmail,
  requireEmail,
  validatePassword,
  validateName,
  validateCurrentPassword,
  validateAvatarUrl,
  validateDeleteConfirmation
};
