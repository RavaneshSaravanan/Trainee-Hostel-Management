export function getJwtSecret() {
  return process.env.JWT_SECRET || 'trainee_hostel_secret_jwt_key_2026';
}
