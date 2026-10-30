import mongoose from 'mongoose';

const notificationLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true }, // 'APPROVAL_REQUEST', 'APPROVAL_DECISION', 'VALIDITY_EXPIRY'
    recipient: { type: String, required: true },
    subject: { type: String, required: true },
    content: { type: String, default: '' },
    status: { type: String, enum: ['SENT', 'FAILED', 'DEV_SIMULATED'], default: 'SENT' },
    error: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true }
);

export const NotificationLog = mongoose.model('NotificationLog', notificationLogSchema);
