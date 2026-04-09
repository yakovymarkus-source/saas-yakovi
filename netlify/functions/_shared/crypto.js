/**
 * crypto.js — AES-256-GCM encryption for integration secrets
 *
 * The APP_ENCRYPTION_KEY env var must be a 64-char hex string (32 bytes).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const nodeCrypto = require('node:crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES  = 12; // 96-bit IV recommended for GCM
const TAG_BYTES = 16;

function getKey() {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) throw new Error('APP_ENCRYPTION_KEY must be a 64-char hex string');
  return Buffer.from(hex.slice(0, 64), 'hex');
}

/**
 * Encrypts a plaintext string.
 * Returns { ciphertext, iv, tag } — all base64 strings for DB storage.
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv  = nodeCrypto.randomBytes(IV_BYTES);
  const cipher = nodeCrypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv:         iv.toString('base64'),
    tag:        tag.toString('base64'),
  };
}

/**
 * Decrypts a { ciphertext, iv, tag } object (all base64).
 * Returns the original plaintext string.
 */
function decrypt({ ciphertext, iv, tag }) {
  const key     = getKey();
  const ivBuf   = Buffer.from(iv, 'base64');
  const tagBuf  = Buffer.from(tag, 'base64');
  const ctBuf   = Buffer.from(ciphertext, 'base64');
  const decipher = nodeCrypto.createDecipheriv(ALGO, key, ivBuf);
  decipher.setAuthTag(tagBuf);
  const decrypted = Buffer.concat([decipher.update(ctBuf), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Re-encrypts (rotates) an existing encrypted blob with a fresh IV.
 * Useful for key rotation.
 */
function reEncrypt(encrypted) {
  const plaintext = decrypt(encrypted);
  return encrypt(plaintext);
}

module.exports = { encrypt, decrypt, reEncrypt };
