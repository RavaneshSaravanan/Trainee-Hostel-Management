import mongoose from 'mongoose';

const approvalLogSchema = new mongoose.Schema(
  {
    traineeId: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: ['SUBMITTED', 'APPROVED', 'REJECTED', 'CONFIG_UPDATED', 'DELETED'],
      required: true,
    },
    actorId: { type: String, default: '' },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true }
);

export const ApprovalLog = mongoose.model('ApprovalLog', approvalLogSchema);
