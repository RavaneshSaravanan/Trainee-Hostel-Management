import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { User } from './models/User.js';
import { Role } from './models/Role.js';
import { DEFAULT_ROLES, SUPER_ROLE } from './defaults.js';
import { nextId } from './utils/dates.js';

dotenv.config();

async function createSuperAdmin() {
  const args = process.argv.slice(2);
  const usernameInput = args[0] || 'superadmin';
  const passwordInput = args[1] || 'superadmin123';
  const nameInput = args[2] || 'Super Administrator';
  const emailInput = args[3] || 'superadmin@hostel.com';
  const mobileInput = args[4] || '9876543210';

  try {
    await connectDB();

    // Ensure roles exist
    const roleCount = await Role.countDocuments();
    if (roleCount === 0) {
      await Role.insertMany(DEFAULT_ROLES);
      console.log('Default roles initialized.');
    }

    const username = String(usernameInput).trim().toLowerCase();
    const passwordHash = await bcrypt.hash(String(passwordInput), 10);

    let user = await User.findOne({ username });
    if (user) {
      user.name = nameInput;
      user.roleId = SUPER_ROLE;
      user.email = emailInput.trim().toLowerCase();
      user.mobile = mobileInput.trim();
      user.active = true;
      user.passwordHash = passwordHash;
      await user.save();
      console.log(`\nExisting user "${username}" has been updated to Super Admin.`);
    } else {
      const allUsers = await User.find({}, 'id').lean();
      const id = nextId('U', allUsers.map((u) => u.id), 1);
      user = await User.create({
        id,
        name: nameInput,
        username,
        email: emailInput.trim().toLowerCase(),
        mobile: mobileInput.trim(),
        roleId: SUPER_ROLE,
        active: true,
        passwordHash,
      });
      console.log(`\nNew Super Admin created successfully.`);
    }

    console.log('-------------------------------------------');
    console.log(` Username : ${username}`);
    console.log(` Password : ${passwordInput}`);
    console.log(` Email    : ${user.email}`);
    console.log(` Mobile   : ${user.mobile}`);
    console.log(` Role     : ${user.roleId}`);
    console.log('-------------------------------------------');
    process.exit(0);
  } catch (err) {
    console.error('Error creating super admin:', err.message);
    process.exit(1);
  }
}

createSuperAdmin();
