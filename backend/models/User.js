import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    email: { type: String, lowercase: true, trim: true, default: '' },
    mobile: { type: String, trim: true, default: '' },
    roleId: { type: String, required: true },
    active: { type: Boolean, default: true },
    passwordHash: { type: String, required: true },
    passwordUpdatedAt: { type: Date, default: Date.now },
    passwordStatus: { type: String, default: 'ACTIVE' },
    mustChangePassword: { type: Boolean, default: false },
    resetToken: { type: String, default: '', index: true },
    resetTokenExpires: { type: Date },
    assignedHostels: { type: [String], default: () => [] },
    passwordResetHistory: {
      type: [
        {
          requestedBy: String,
          resetType: { type: String, default: 'DIRECT' }, // DIRECT | RESET_LINK | TEMPORARY
          createdAt: { type: Date, default: Date.now },
          usedAt: Date,
          revokedAt: Date,
        },
      ],
      default: () => [],
    },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
