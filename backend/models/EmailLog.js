import mongoose from 'mongoose';

const emailLogSchema = new mongoose.Schema(
  {
    recipient: { type: String, required: true },
    to: { type: [String], default: () => [] },
    cc: { type: [String], default: () => [] },
    bcc: { type: [String], default: () => [] },
    subject: { type: String, required: true },
    emailType: {
      type: String,
      default: 'GENERAL',
      index: true,
    },
    status: {
      type: String,
      default: 'SENT',
      index: true,
    },
    error: { type: String, default: '' },
    traineeId: { type: String, default: '', index: true },
    traineeName: { type: String, default: '' },
    sentAt: { type: Date, default: Date.now, index: true },
    triggeredBy: { type: String, default: 'System' },
    content: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true }
);

export const EmailLog = mongoose.model('EmailLog', emailLogSchema);
