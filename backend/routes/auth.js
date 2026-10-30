import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { bumpRev } from '../models/Meta.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email || '',
  mobile: u.mobile || '',
  roleId: u.roleId,
  active: u.active,
});

// ---------------- Login ----------------
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username = '', password = '' } = req.body || {};
    const u = await User.findOne({
      username: String(username).trim().toLowerCase(),
    });

    if (!u || !u.active || !(await bcrypt.compare(String(password), u.passwordHash))) {
      await new Promise((r) => setTimeout(r, 600));
      return res.status(401).json({ error: 'Wrong username or password.' });
    }

    const secret = process.env.JWT_SECRET || 'trainee_hostel_secret_jwt_key_2026';
    const token = jwt.sign(
      { id: u.id, username: u.username, roleId: u.roleId },
      secret,
      { expiresIn: '7d' }
    );

    return res.json({ token, user: safeUser(u) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Change Password (when logged in) ----------------
router.post('/me/password', auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    const u = req.user;

    const matches = await bcrypt.compare(String(oldPassword || ''), u.passwordHash);
    if (!matches) {
      return res.status(400).json({ error: 'Current password is wrong.' });
    }

    if (String(newPassword || '').length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters.' });
    }

    u.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await u.save();

    await bumpRev();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
