import express from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { bumpRev } from '../models/Meta.js';
import { auth, requireSuper } from '../middleware/auth.js';
import { nextId } from '../utils/dates.js';

const router = express.Router();

const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email || '',
  mobile: u.mobile || '',
  roleId: u.roleId,
  active: u.active,
});

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

      // At least one (email or mobile) is mandatory
      if (!email && !mobile) {
        return res.status(400).json({
          error: 'At least one contact method (Email or Mobile number) is mandatory for password recovery via OTP.',
        });
      }

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
        if (password) {
          cur.passwordHash = await bcrypt.hash(String(password), 10);
        }
        await cur.save();
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

export default router;
