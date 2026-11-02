import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema(
  {
    userId: { type: String, default: 'anonymous', index: true },
    identifier: { type: String, required: true, index: true },
    otp: { type: String, required: true },
    type: { type: String, default: 'password-reset' },
    used: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

export const Otp = mongoose.model('Otp', otpSchema);
