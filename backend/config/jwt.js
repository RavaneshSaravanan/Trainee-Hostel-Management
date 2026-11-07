/**
 * Centralized JWT configuration and secret validation.
 * In production: Strictly requires a non-default, high-entropy JWT_SECRET (minimum 32 characters).
 * In development: Provides safe fallback without risking production compromise.
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    if (
      !secret ||
      secret.trim().length < 32 ||
      secret.includes('secret_jwt_key') ||
      secret === 'trainee_hostel_secret_jwt_key_2026'
    ) {
      throw new Error(
        'FATAL SECURITY ERROR: A secure, unique JWT_SECRET of at least 32 characters is strictly required in production.'
      );
    }
    return secret.trim();
  }

  // Safe fallback for local development only
  return (secret && secret.trim()) || 'development_insecure_jwt_secret_min_32_characters_for_local_testing_only';
}
