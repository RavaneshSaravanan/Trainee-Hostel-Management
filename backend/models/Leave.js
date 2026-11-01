import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    traineeId: { type: String, default: '', index: true },
    qrId: { type: String, default: '', index: true },
    traineeName: { type: String, default: '' },
    hostel: { type: String, default: '' },
    roomNo: { type: String, default: '' },
    leaveType: { type: String, default: 'Casual Leave' },
    reason: { type: String, default: '' },
    outDate: { type: String, default: '' },
    outTime: { type: String, default: '' },
    inDate: { type: String, default: '' },
    inTime: { type: String, default: '' },
    duration: { type: String, default: '' },
    isCompleted: { type: Boolean, default: false, index: true },
    fromDate: { type: String, default: '' },
    toDate: { type: String, default: '' },
    days: { type: Number, default: 1 },
    status: { type: String, default: 'APPROVED' },
    remarks: { type: String, default: '' },
    leaveDate: { type: String, default: '' },
    recordedBy: { type: String, default: '' },
    closedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Leave = mongoose.model('Leave', leaveSchema);
