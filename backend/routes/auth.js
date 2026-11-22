import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { Otp } from '../models/Otp.js';
import { auth } from '../middleware/auth.js';
import { bumpRev } from '../models/Meta.js';
import { getJwtSecret } from '../config/jwt.js';
import {
  sendForgotPasswordEmail,
  sendPasswordResetConfirmationEmail,
  sendLoginOtpEmail,
  getAppUrl,
} from '../services/emailService.js';
import { isValidEmail } from '../utils/validators.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many password reset requests. Please try again later.' },
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
  passwordUpdatedAt: u.passwordUpdatedAt || u.updatedAt || u.createdAt || null,
  passwordStatus: u.passwordStatus || 'ACTIVE',
  mustChangePassword: !!u.mustChangePassword,
  assignedHostels: Array.isArray(u.assignedHostels) ? u.assignedHostels : [],
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

    const secret = getJwtSecret();
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

// ---------------- Change Password (when logged in or forced at login) ----------------
router.post('/me/password', auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    const u = req.user;

    // If user is forced to change password (mustChangePassword), they might not know or need oldPassword if temporary
    if (!u.mustChangePassword) {
      const matches = await bcrypt.compare(String(oldPassword || ''), u.passwordHash);
      if (!matches) {
        return res.status(400).json({ error: 'Current password is wrong.' });
      }
    }

    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters.' });
    }

    u.passwordHash = await bcrypt.hash(String(newPassword), 10);
    u.passwordUpdatedAt = new Date();
    u.passwordStatus = 'ACTIVE';
    u.mustChangePassword = false;
    await u.save();

    await bumpRev();
    return res.json({ ok: true, message: 'Password updated successfully.', user: safeUser(u) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Verify Password Reset Link Token ----------------
router.get('/auth/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token is required.' });

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: new Date() },
    }).lean();

    if (!user) {
      return res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
    }

    return res.json({
      ok: true,
      user: { id: user.id, name: user.name, username: user.username },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Public Forgot Password Request (Dispatches Resend Email) ----------------
router.post('/auth/forgot-password', resetLimiter, async (req, res) => {
  try {
    const { identifier = '' } = req.body || {};
    const clean = String(identifier).trim().toLowerCase();

    if (!clean) {
      return res.status(400).json({ error: 'Please enter your username or registered email address.' });
    }

    const query = clean.includes('@')
      ? { email: clean, active: true }
      : { username: clean, active: true };

    const user = await User.findOne(query);

    // Generic success response to prevent account enumeration
    const genericResponse = {
      ok: true,
      message: 'If an account exists with the provided information, a password reset link has been dispatched to your registered email.',
    };

    if (!user || !user.email || !isValidEmail(user.email)) {
      await new Promise((r) => setTimeout(r, 600));
      return res.json(genericResponse);
    }

    // Generate high-entropy 32-byte cryptographic token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiration

    user.resetToken = token;
    user.resetTokenExpires = expiresAt;

    if (!Array.isArray(user.passwordResetHistory)) {
      user.passwordResetHistory = [];
    }
    user.passwordResetHistory.push({
      requestedAt: new Date(),
      expiresAt,
      resetType: 'FORGOT_PASSWORD_EMAIL',
    });

    await user.save();

    const appUrl = getAppUrl();
    const resetUrl = `${appUrl}/#/reset-password?token=${token}`;

    // Dispatch transactional email via Resend
    sendForgotPasswordEmail({
      email: user.email,
      resetUrl,
      name: user.name || user.username,
      expiresHours: 1,
    }).catch((err) => console.error('[Forgot Password Email Dispatch Error]', err.message));

    return res.json(genericResponse);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Reset Password with Link Token (Public) ----------------
router.post('/auth/reset-password-with-token', async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: 'Reset token is required.' });
    }

    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters.' });
    }

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: 'This reset link has expired or is invalid. Please request a new one.' });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    user.passwordUpdatedAt = new Date();
    user.passwordStatus = 'ACTIVE';
    user.mustChangePassword = false;
    user.resetToken = '';
    user.resetTokenExpires = null;

    if (Array.isArray(user.passwordResetHistory) && user.passwordResetHistory.length > 0) {
      const last = user.passwordResetHistory[user.passwordResetHistory.length - 1];
      if (!last.usedAt && !last.revokedAt) {
        last.usedAt = new Date();
      }
    }

    await user.save();
    await bumpRev();

    // Dispatch Password Reset Confirmation Email via Resend
    if (user.email && isValidEmail(user.email)) {
      sendPasswordResetConfirmationEmail({
        email: user.email,
        name: user.name || user.username,
        loginUrl: `${getAppUrl()}/#/login`,
      }).catch((err) => console.error('[Password Reset Confirmation Email Error]', err.message));
    }

    return res.json({
      ok: true,
      message: 'Password successfully reset. You can now log in with your new password.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Send Login OTP (2FA / Passwordless) ----------------
router.post('/auth/send-login-otp', loginLimiter, async (req, res) => {
  try {
    const { username = '', password = '' } = req.body || {};
    const cleanUsername = String(username).trim().toLowerCase();

    const user = await User.findOne({ username: cleanUsername });
    if (!user || !user.active) {
      await new Promise((r) => setTimeout(r, 600));
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (password && !(await bcrypt.compare(String(password), user.passwordHash))) {
      await new Promise((r) => setTimeout(r, 600));
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (!user.email || !isValidEmail(user.email)) {
      return res.status(400).json({ error: 'No verified email address associated with this account for OTP delivery.' });
    }

    // Cooldown check (60s)
    const recentOtp = await Otp.findOne({
      identifier: user.email.toLowerCase(),
      type: 'login-otp',
      used: false,
      createdAt: { $gt: new Date(Date.now() - 60 * 1000) },
    }).lean();

    if (recentOtp) {
      const waitSeconds = Math.max(1, Math.ceil((new Date(recentOtp.createdAt).getTime() + 60 * 1000 - Date.now()) / 1000));
      return res.status(429).json({ error: `Please wait ${waitSeconds} seconds before requesting a new login code.` });
    }

    // Generate secure 6-digit numeric OTP
    const otpCode = String(crypto.randomInt(100000, 1000000));
    const hashedOtp = await bcrypt.hash(otpCode, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Invalidate prior unused login OTPs
    await Otp.updateMany(
      { identifier: user.email.toLowerCase(), type: 'login-otp', used: false },
      { $set: { used: true } }
    );

    await Otp.create({
      userId: user.id,
      identifier: user.email.toLowerCase(),
      otp: hashedOtp,
      type: 'login-otp',
      expiresAt,
    });

    const dispatchResult = await sendLoginOtpEmail({
      email: user.email,
      otp: otpCode,
      username: user.username,
      ipAddress: req.ip,
    });

    if (!dispatchResult || !dispatchResult.ok) {
      return res.status(500).json({ error: dispatchResult?.error || 'Failed to dispatch login OTP email.' });
    }

    return res.json({
      ok: true,
      message: 'Login verification code sent to your registered email address.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Verify Login OTP ----------------
router.post('/auth/verify-login-otp', loginLimiter, async (req, res) => {
  try {
    const { username = '', otp = '' } = req.body || {};
    const cleanUsername = String(username).trim().toLowerCase();
    const cleanOtp = String(otp).trim();

    if (!cleanOtp || !/^\d{6}$/.test(cleanOtp)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit verification code.' });
    }

    const user = await User.findOne({ username: cleanUsername });
    if (!user || !user.active || !user.email) {
      return res.status(401).json({ error: 'User not found or inactive.' });
    }

    const otpDoc = await Otp.findOne({
      identifier: user.email.toLowerCase(),
      type: 'login-otp',
      used: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpDoc) {
      return res.status(400).json({ error: 'Verification code has expired or is invalid. Please request a new code.' });
    }

    if (otpDoc.attempts >= 5) {
      otpDoc.used = true;
      await otpDoc.save();
      return res.status(400).json({ error: 'Too many failed attempts. Please request a new code.' });
    }

    const isMatch = await bcrypt.compare(cleanOtp, otpDoc.otp);
    if (!isMatch) {
      otpDoc.attempts += 1;
      if (otpDoc.attempts >= 5) otpDoc.used = true;
      await otpDoc.save();
      const remaining = Math.max(0, 5 - otpDoc.attempts);
      return res.status(400).json({
        error: remaining > 0
          ? `Incorrect code. You have ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many failed attempts. Please request a new code.',
      });
    }

    // Mark single-use OTP as used
    otpDoc.used = true;
    await otpDoc.save();

    const secret = getJwtSecret();
    const token = jwt.sign(
      { id: user.id, username: user.username, roleId: user.roleId },
      secret,
      { expiresIn: '7d' }
    );

    return res.json({ token, user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
