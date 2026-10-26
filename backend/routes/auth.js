import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { Otp } from '../models/Otp.js';
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

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many OTP requests. Please try again after 15 minutes.' },
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

function maskContact(email, mobile) {
  const parts = [];
  if (email) {
    const [name, domain] = email.split('@');
    const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : `${name}***`;
    parts.push(`${maskedName}@${domain || 'mail.com'}`);
  }
  if (mobile) {
    const maskedMobile = mobile.length > 4 ? `${mobile.slice(0, 2)}******${mobile.slice(-2)}` : '******';
    parts.push(maskedMobile);
  }
  return parts.join(' / ');
}

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

// ---------------- Send OTP for Forgot Password ----------------
const sendOtpHandler = async (req, res) => {
  try {
    const { identifier = '' } = req.body || {};
    const cleanId = String(identifier).trim();
    if (!cleanId) {
      return res.status(400).json({ error: 'Please enter your username, email, or mobile number.' });
    }

    const u = await User.findOne({
      $or: [
        { username: cleanId.toLowerCase() },
        { email: cleanId.toLowerCase() },
        { mobile: cleanId },
      ],
      active: true,
    });

    if (!u) {
      return res.status(404).json({ error: 'No active user found with this username, email, or mobile.' });
    }

    if (!u.email && !u.mobile) {
      return res.status(400).json({
        error: 'This account has no registered email or mobile number. Please contact Super Admin.',
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await Otp.deleteMany({ userId: u.id, type: 'password-reset' });

    await Otp.create({
      userId: u.id,
      identifier: cleanId,
      otp,
      type: 'password-reset',
      expiresAt,
    });

    const destination = maskContact(u.email, u.mobile);
    console.log(`\n========================================`);
    console.log(`[OTP] Password Reset Code for "${u.username}" (${destination}): ${otp}`);
    console.log(`========================================\n`);

    return res.json({
      ok: true,
      message: `OTP sent successfully to ${destination}.`,
      destination,
      devOtp: otp, // Included for development/testing convenience
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

router.post('/auth/forgot-password/send-otp', otpLimiter, sendOtpHandler);
router.post('/forgot-password/send-otp', otpLimiter, sendOtpHandler);

// ---------------- Verify OTP & Reset Password ----------------
const verifyOtpHandler = async (req, res) => {
  try {
    const { identifier = '', otp = '', newPassword = '' } = req.body || {};
    const cleanId = String(identifier).trim();
    const cleanOtp = String(otp).trim();

    if (!cleanId || !cleanOtp || !newPassword) {
      return res.status(400).json({ error: 'Username/Email/Mobile, OTP code, and new password are required.' });
    }

    if (String(newPassword).length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters long.' });
    }

    const u = await User.findOne({
      $or: [
        { username: cleanId.toLowerCase() },
        { email: cleanId.toLowerCase() },
        { mobile: cleanId },
      ],
      active: true,
    });

    if (!u) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const otpDoc = await Otp.findOne({
      userId: u.id,
      otp: cleanOtp,
      type: 'password-reset',
      used: false,
      expiresAt: { $gt: new Date() },
    });

    if (!otpDoc) {
      return res.status(400).json({ error: 'Invalid or expired OTP code. Please request a new one.' });
    }

    u.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await u.save();

    otpDoc.used = true;
    await otpDoc.save();

    await bumpRev();
    return res.json({
      ok: true,
      message: 'Password reset successfully! You can now log in with your new password.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

router.post('/auth/forgot-password/verify-otp', otpLimiter, verifyOtpHandler);
router.post('/forgot-password/verify-otp', otpLimiter, verifyOtpHandler);

export default router;
