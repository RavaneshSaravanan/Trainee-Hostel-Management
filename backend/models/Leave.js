import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    traineeId: { type: String, required: true, index: true },
    leaveType: { type: String, default: 'Casual Leave' },
    fromDate: { type: String, required: true },
    toDate: { type: String, required: true },
    days: { type: Number, default: 1 },
    reason: { type: String, default: '' },
    status: { type: String, default: 'PENDING' },
    remarks: { type: String, default: '' },
    leaveDate: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Leave = mongoose.model('Leave', leaveSchema);
