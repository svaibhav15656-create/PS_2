const crypto = require('crypto');

const RAW_KEY = process.env.ENCRYPTION_KEY || 'setuone-sih129-secret-encryption-key-32b';
const KEY = crypto.createHash('sha256').update(RAW_KEY).digest();
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.startsWith('enc:')) return text; // already encrypted
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(text) {
  if (!text || typeof text !== 'string' || !text.startsWith('enc:')) return text;
  try {
    const parts = text.split(':');
    if (parts.length !== 4) return text;
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encryptedText = parts[3];
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return text; // Return text on decryption error
  }
}

function maskAadhaar(aadhaar) {
  if (!aadhaar) return null;
  const raw = aadhaar.startsWith('enc:') ? decrypt(aadhaar) : aadhaar;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length >= 4) {
    return `XXXX-XXXX-${digits.slice(-4)}`;
  }
  return 'XXXX-XXXX-XXXX';
}

module.exports = { encrypt, decrypt, maskAadhaar };
