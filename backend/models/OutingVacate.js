import mongoose from 'mongoose';

const outingVacateSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    traineeId: { type: String, default: '', index: true },
    qrId: { type: String, default: '', index: true },
    traineeName: { type: String, default: '' },
    hostel: { type: String, default: '' },
    roomNo: { type: String, default: '' },
    type: { type: String, default: 'OUTING' },
    purpose: { type: String, default: '' },
    reason: { type: String, default: '' },
    outDate: { type: String, default: '' },
    outTime: { type: String, default: '' },
    inDate: { type: String, default: '' },
    inTime: { type: String, default: '' },
    duration: { type: String, default: '' },
    isCompleted: { type: Boolean, default: false, index: true },
    date: { type: String, default: '' },
    fromDate: { type: String, default: '' },
    expectedReturn: { type: String, default: '' },
    status: { type: String, default: 'APPROVED' },
    remarks: { type: String, default: '' },
    recordedBy: { type: String, default: '' },
    closedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

export const OutingVacate = mongoose.model('OutingVacate', outingVacateSchema);
