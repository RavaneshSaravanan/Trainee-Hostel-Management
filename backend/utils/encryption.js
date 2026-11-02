// backend/utils/encryption.js
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-cbc';
const SECRET_KEY = crypto
  .createHash('sha256')
  .update(process.env.JWT_SECRET || 'trainee_hostel_secret_jwt_key_2026')
  .digest();

/** Encrypt sensitive Aadhaar number using AES-256-CBC */
export function encryptAadhaar(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/** Decrypt sensitive Aadhaar number */
export function decryptAadhaar(encryptedText) {
  if (!encryptedText || !encryptedText.includes(':')) return '';
  try {
    const [ivHex, data] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return '';
  }
}

/** Mask Aadhaar number to display only last 4 digits (e.g. XXXX-XXXX-1234) */
export function maskAadhaar(aadhar) {
  const clean = String(aadhar || '').replace(/\D/g, '');
  if (clean.length === 12) {
    return `XXXX-XXXX-${clean.slice(8)}`;
  }
  return aadhar || '';
}

/** SHA-256 hash for secure duplicate Aadhaar detection without storing plain text */
export function hashAadhaar(aadhar) {
  const clean = String(aadhar || '').replace(/\D/g, '');
  if (!clean) return '';
  return crypto.createHash('sha256').update(clean).digest('hex');
}
