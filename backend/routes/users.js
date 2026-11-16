import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { Config } from '../models/Config.js';
import { bumpRev } from '../models/Meta.js';
import { auth, requireSuper } from '../middleware/auth.js';
import { nextId } from '../utils/dates.js';
import { getAppUrl } from '../services/emailService.js';

const router = express.Router();

export const safeUser = (u) => ({
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
  hasActiveResetLink: Boolean(u.resetToken && u.resetTokenExpires && new Date(u.resetTokenExpires) > new Date()),
  passwordResetHistory: Array.isArray(u.passwordResetHistory)
    ? u.passwordResetHistory.map((h) => ({
        requestedBy: h.requestedBy || 'Super Admin',
        resetType: h.resetType || 'DIRECT',
        createdAt: h.createdAt,
        usedAt: h.usedAt,
        revokedAt: h.revokedAt,
      }))
    : [],
});

// ---------------- User Management (Create / Update / Delete) ----------------
router.post('/users', auth, requireSuper, async (req, res) => {
  try {
    const { action, user = {}, password } = req.body || {};
    const u = req.user;

    if (action === 'delete') {
      if (user.id === u.id) {
        return res.status(400).json({ error: 'You cannot delete yourself.' });
      }
      await User.deleteOne({ id: user.id });
    } else {
      const username = String(user.username || '').trim();
      if (!username || !user.name) {
        return res.status(400).json({ error: 'Name and username are required.' });
      }

      const email = String(user.email || '').trim().toLowerCase();
      const mobile = String(user.mobile || '').trim();

      // Check username uniqueness
      const existingUsername = await User.findOne({
        username: username.toLowerCase(),
        id: { $ne: user.id },
      });
      if (existingUsername) {
        return res.status(409).json({ error: 'Username already taken.' });
      }

      // Check email uniqueness if provided
      if (email) {
        const existingEmail = await User.findOne({
          email,
          id: { $ne: user.id },
        });
        if (existingEmail) {
          return res.status(409).json({ error: 'Email ID already registered with another user.' });
        }
      }

      // Check mobile uniqueness if provided
      if (mobile) {
        const existingMobile = await User.findOne({
          mobile,
          id: { $ne: user.id },
        });
        if (existingMobile) {
          return res.status(409).json({ error: 'Mobile number already registered with another user.' });
        }
      }

      const roles = await Role.find({}).lean();
      if (!roles.some((r) => r.id === user.roleId)) {
        return res.status(400).json({ error: 'Pick a valid role.' });
      }

      const cur = await User.findOne({ id: user.id });
      if (cur) {
        if (cur.id === u.id && (user.roleId !== cur.roleId || user.active === false)) {
          return res.status(400).json({ error: 'You cannot change your own role / disable yourself.' });
        }
        cur.name = user.name;
        cur.username = username;
        cur.email = email;
        cur.mobile = mobile;
        cur.roleId = user.roleId;
        cur.active = user.active !== false;
        if (Array.isArray(user.assignedHostels)) {
          cur.assignedHostels = user.assignedHostels;
        }
        if (password) {
          cur.passwordHash = await bcrypt.hash(String(password), 10);
          cur.passwordUpdatedAt = new Date();
          cur.passwordStatus = 'ACTIVE';
          cur.mustChangePassword = false;
        }
        await cur.save();

        // Synchronize admin notification email if this user is a superadmin or admin
        if (cur.roleId === 'superadmin' || cur.username === 'admin') {
          if (email) {
            await Config.findOneAndUpdate(
              { key: 'main' },
              { $set: { adminNotificationEmail: email } }
            );
          }
        }

        // Synchronize approvers snapshot in Config.approvalConfig
        const cfg = await Config.findOne({ key: 'main' });
        if (cfg?.approvalConfig?.approvers?.length > 0) {
          let approversModified = false;
          cfg.approvalConfig.approvers = cfg.approvalConfig.approvers.map((appr) => {
            if (appr.userId === cur.id || appr.username === cur.username) {
              approversModified = true;
              return { ...appr, email: email || '', name: cur.name, roleId: cur.roleId };
            }
            return appr;
          });
          if (approversModified) {
            cfg.markModified('approvalConfig');
            await cfg.save();
          }
        }
      } else {
        if (!password || String(password).length < 4) {
          return res.status(400).json({ error: 'Password must be at least 4 characters.' });
        }
        const allUsers = await User.find({}, 'id').lean();
        const newId = nextId('U', allUsers.map((x) => x.id), 1);
        const passwordHash = await bcrypt.hash(String(password), 10);
        await User.create({
          id: newId,
          name: user.name,
          username,
          email,
          mobile,
          roleId: user.roleId,
          active: true,
          passwordHash,
          passwordUpdatedAt: new Date(),
          passwordStatus: 'ACTIVE',
          mustChangePassword: false,
          assignedHostels: Array.isArray(user.assignedHostels) ? user.assignedHostels : [],
        });
      }
    }

    await bumpRev();
    const updatedUsers = await User.find({}).sort({ createdAt: 1 }).lean();
    return res.json({ users: updatedUsers.map(safeUser) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Super Admin Authorized Password Reset ----------------
router.post('/users/reset-password', auth, requireSuper, async (req, res) => {
  try {
    const { userId, newPassword, temporary = false, forceChangeOnLogin = false } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required.' });
    }

    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters.' });
    }

    const targetUser = await User.findOne({ id: userId });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const shouldForce = Boolean(temporary || forceChangeOnLogin);
    targetUser.passwordHash = await bcrypt.hash(String(newPassword), 10);
    targetUser.passwordUpdatedAt = new Date();
    targetUser.mustChangePassword = shouldForce;
    targetUser.passwordStatus = shouldForce ? 'CHANGE_REQUIRED' : 'ACTIVE';
    targetUser.resetToken = '';
    targetUser.resetTokenExpires = null;

    targetUser.passwordResetHistory.push({
      requestedBy: req.user?.username || 'superadmin',
      resetType: shouldForce ? 'TEMPORARY' : 'DIRECT',
      createdAt: new Date(),
    });

    await targetUser.save();
    await bumpRev();

    const updatedUsers = await User.find({}).sort({ createdAt: 1 }).lean();
    return res.json({
      ok: true,
      message: `Password successfully updated for ${targetUser.name} (${targetUser.username}).` +
        (shouldForce ? ' User will be prompted to change password at next login.' : ''),
      user: safeUser(targetUser),
      users: updatedUsers.map(safeUser),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Generate Secure Reset Link ----------------
router.post('/users/generate-reset-link', auth, requireSuper, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required.' });
    }

    const targetUser = await User.findOne({ id: userId });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    targetUser.resetToken = token;
    targetUser.resetTokenExpires = expiresAt;
    targetUser.passwordResetHistory.push({
      requestedBy: req.user?.username || 'superadmin',
      resetType: 'RESET_LINK',
      createdAt: new Date(),
    });

    await targetUser.save();

    const appUrl = getAppUrl();
    const resetUrl = `${appUrl}/#/reset-password?token=${token}`;

    return res.json({
      ok: true,
      message: `Secure password reset link generated for ${targetUser.name}.`,
      resetUrl,
      token,
      expiresAt,
      user: safeUser(targetUser),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Revoke Active Reset Link ----------------
router.post('/users/revoke-reset-link', auth, requireSuper, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required.' });
    }

    const targetUser = await User.findOne({ id: userId });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    targetUser.resetToken = '';
    targetUser.resetTokenExpires = null;

    if (Array.isArray(targetUser.passwordResetHistory) && targetUser.passwordResetHistory.length > 0) {
      const last = targetUser.passwordResetHistory[targetUser.passwordResetHistory.length - 1];
      if (!last.usedAt && !last.revokedAt) {
        last.revokedAt = new Date();
      }
    }

    await targetUser.save();

    return res.json({
      ok: true,
      message: `Active reset link revoked for ${targetUser.name}.`,
      user: safeUser(targetUser),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- User Self Change Password (with Current Password Verification) ----------------
router.post('/users/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (String(newPassword).length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters.' });
    }
    const user = await User.findOne({ id: req.user.id });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const match = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!match) {
      return res.status(400).json({ error: 'Current password does not match.' });
    }
    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    user.passwordUpdatedAt = new Date();
    user.mustChangePassword = false;
    user.passwordStatus = 'ACTIVE';
    user.passwordResetHistory.push({
      requestedBy: user.username,
      resetType: 'SELF_CHANGE',
      createdAt: new Date(),
    });
    await user.save();
    await bumpRev();
    return res.json({ ok: true, message: 'Password changed successfully.', user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
