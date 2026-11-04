import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { User } from './models/User.js';
import { Role } from './models/Role.js';
import { Config } from './models/Config.js';
import { Hostel } from './models/Hostel.js';
import { Trainee } from './models/Trainee.js';
import { Attendance } from './models/Attendance.js';
import { Leave } from './models/Leave.js';
import { OutingVacate } from './models/OutingVacate.js';
import { Resignation } from './models/Resignation.js';
import { Remark } from './models/Remark.js';
import { RoomHistory } from './models/RoomHistory.js';
import { DailySummary } from './models/DailySummary.js';
import { Meta } from './models/Meta.js';
import { DEFAULT_CONFIG, DEFAULT_ROLES } from './defaults.js';
import { nextId } from './utils/dates.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function seedDatabase() {
  const superAdminHash = await bcrypt.hash('superadmin123', 10);
  const wardenHash = await bcrypt.hash('warden123', 10);
  const adminHash = await bcrypt.hash('admin123', 10);

  const defaultAdminEmail = (process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'apollotyres.hostel@gmail.com').trim().toLowerCase();

  const userCount = await User.countDocuments();
  if (userCount > 0) {
    const existingConfig = await Config.findOne({ key: 'main' });
    const configuredAdminEmail = existingConfig?.adminNotificationEmail && !existingConfig.adminNotificationEmail.endsWith('@hostel.com')
      ? existingConfig.adminNotificationEmail.trim().toLowerCase()
      : defaultAdminEmail;

    // Ensure superadmin exists with requested password & live email
    let superUser = await User.findOne({ username: 'superadmin' });
    if (!superUser) {
      const allUsers = await User.find({}, 'id').lean();
      const id = nextId('U', allUsers.map((u) => u.id), 1);
      superUser = await User.create({
        id,
        name: 'Super Admin',
        username: 'superadmin',
        email: configuredAdminEmail,
        mobile: '9876543210',
        roleId: 'superadmin',
        active: true,
        passwordHash: superAdminHash,
      });
      console.log('Created superadmin user (password: superadmin123).');
    } else {
      superUser.passwordHash = superAdminHash;
      superUser.roleId = 'superadmin';
      superUser.active = true;
      if (!superUser.email || superUser.email.endsWith('@hostel.com')) {
        superUser.email = configuredAdminEmail;
      }
      if (!superUser.mobile) superUser.mobile = '9876543210';
      await superUser.save();
      console.log('Synchronized superadmin password to superadmin123.');
    }

    // Ensure warden exists with requested password & live email
    const configuredWardenEmail = process.env.WARDEN_EMAIL && !process.env.WARDEN_EMAIL.endsWith('@hostel.com')
      ? process.env.WARDEN_EMAIL.trim().toLowerCase()
      : configuredAdminEmail;

    let wardenUser = await User.findOne({ username: 'warden' });
    if (!wardenUser) {
      const allUsers = await User.find({}, 'id').lean();
      const id = nextId('U', allUsers.map((u) => u.id), 1);
      await User.create({
        id,
        name: 'Warden',
        username: 'warden',
        email: configuredWardenEmail,
        mobile: '9876543211',
        roleId: 'warden',
        active: true,
        passwordHash: wardenHash,
      });
      console.log('Created warden user (password: warden123).');
    } else {
      wardenUser.passwordHash = wardenHash;
      wardenUser.roleId = 'warden';
      wardenUser.active = true;
      if (!wardenUser.email || wardenUser.email.endsWith('@hostel.com')) {
        wardenUser.email = configuredWardenEmail;
      }
      if (!wardenUser.mobile) wardenUser.mobile = '9876543211';
      await wardenUser.save();
      console.log('Synchronized warden password to warden123.');
    }

    // Ensure admin exists with default password & live email
    let adminUser = await User.findOne({ username: 'admin' });
    if (!adminUser) {
      const allUsers = await User.find({}, 'id').lean();
      const id = nextId('U', allUsers.map((u) => u.id), 1);
      await User.create({
        id,
        name: 'Admin',
        username: 'admin',
        email: configuredAdminEmail,
        mobile: '9876543212',
        roleId: 'superadmin',
        active: true,
        passwordHash: adminHash,
      });
      console.log('Created admin user (password: admin123).');
    } else {
      adminUser.passwordHash = adminHash;
      adminUser.roleId = 'superadmin';
      adminUser.active = true;
      if (!adminUser.email || adminUser.email.endsWith('@hostel.com')) {
        adminUser.email = configuredAdminEmail;
      }
      if (!adminUser.mobile) adminUser.mobile = '9876543212';
      await adminUser.save();
      console.log('Synchronized admin password to admin123.');
    }

    // Ensure Config has adminNotificationEmail and approvalConfig.approvers configured
    if (existingConfig) {
      let cfgChanged = false;
      if (!existingConfig.adminNotificationEmail || existingConfig.adminNotificationEmail.endsWith('@hostel.com')) {
        existingConfig.adminNotificationEmail = configuredAdminEmail;
        cfgChanged = true;
      }
      if (!existingConfig.approvalConfig?.approvers || existingConfig.approvalConfig.approvers.length === 0) {
        existingConfig.approvalConfig = {
          approvers: [
            {
              userId: superUser.id,
              name: superUser.name,
              username: superUser.username,
              email: configuredAdminEmail,
              roleId: superUser.roleId,
            },
          ],
          policy: 'ANY_ONE',
          configuredAt: new Date(),
          configuredBy: 'system',
        };
        existingConfig.markModified('approvalConfig');
        cfgChanged = true;
      }
      if (cfgChanged) {
        await existingConfig.save();
        console.log(`Synchronized admin notification email and approval approver: ${configuredAdminEmail}`);
      }
    }

    return;
  }

  console.log('Database empty. Running seed...');

  // 1. Roles
  const existingRoles = await Role.find({}).lean();
  if (existingRoles.length === 0) {
    await Role.insertMany(DEFAULT_ROLES);
    console.log('Default roles created.');
  }

  // 2. Users
  await User.create([
    {
      id: 'U-1',
      name: 'Super Admin',
      username: 'admin',
      email: 'admin@hostel.com',
      mobile: '9876543212',
      roleId: 'superadmin',
      active: true,
      passwordHash: adminHash,
    },
    {
      id: 'U-2',
      name: 'Super Admin',
      username: 'superadmin',
      email: 'superadmin@hostel.com',
      mobile: '9876543210',
      roleId: 'superadmin',
      active: true,
      passwordHash: superAdminHash,
    },
    {
      id: 'U-3',
      name: 'Warden',
      username: 'warden',
      email: 'warden@hostel.com',
      mobile: '9876543211',
      roleId: 'warden',
      active: true,
      passwordHash: wardenHash,
    },
  ]);
  console.log('Default users created (superadmin: superadmin123 / warden: warden123 / admin: admin123).');

  // 3. Config
  const existingConfig = await Config.findOne({ key: 'main' });
  if (!existingConfig) {
    await Config.create({
      key: 'main',
      ...DEFAULT_CONFIG,
    });
    console.log('Default config created.');
  }

  // 4. Meta rev
  await Meta.findOneAndUpdate(
    { key: 'state_rev' },
    { $setOnInsert: { rev: 1 } },
    { upsert: true }
  );

  console.log('Seeding completed successfully (clean production schema initialized).');
}

// When called directly via `npm run seed` or `node seed.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    try {
      await connectDB();
      await seedDatabase();
      process.exit(0);
    } catch (err) {
      console.error('Seed error:', err);
      process.exit(1);
    }
  })();
}
