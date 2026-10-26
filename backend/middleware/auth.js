import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { SUPER_ROLE, DEFAULT_ROLES } from '../defaults.js';

export async function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }

    const secret = process.env.JWT_SECRET || 'trainee_hostel_secret_jwt_key_2026';
    const decoded = jwt.verify(token, secret);

    const user = await User.findOne({ id: decoded.id, active: true });
    if (!user) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Please sign in again.' });
  }
}

export function requireSuper(req, res, next) {
  if (!req.user || req.user.roleId !== SUPER_ROLE) {
    return res.status(403).json({ error: 'Super Admin only.' });
  }
  next();
}

/**
 * Server-side authorization guard for Reports module:
 * - Super Admin: granted full access.
 * - Warden: strictly blocked (HTTP 403 Forbidden).
 * - Custom roles: verified dynamically against role.pages permissions matrix in MongoDB.
 */
export async function requireReports(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Please sign in again.' });
  }

  // Super Admin always has full access
  if (req.user.roleId === SUPER_ROLE) {
    return next();
  }

  // Explicitly deny Warden role from accessing Reports on the backend
  if (req.user.roleId === 'warden') {
    return res.status(403).json({
      error: 'Access denied: Warden role is not authorized to access Reports.',
    });
  }

  // For other roles, inspect the role's permitted pages in DB
  try {
    let role = await Role.findOne({ id: req.user.roleId }).lean();
    if (!role) {
      role = DEFAULT_ROLES.find((r) => r.id === req.user.roleId);
    }
    if (!role || !Array.isArray(role.pages) || !role.pages.includes('reports')) {
      return res.status(403).json({
        error: `Access denied: Your role (${role ? role.name : req.user.roleId}) is not authorized to access Reports.`,
      });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Authorization error checking role permissions.' });
  }
}
