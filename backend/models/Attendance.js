import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    traineeId: { type: String, default: '', index: true },
    qrId: { type: String, default: '', index: true },
    hostel: { type: String, default: '', index: true },
    hostelId: { type: String, default: '', index: true },
    roomNo: { type: String, default: '' },
    date: { type: String, required: true, index: true },
    shift: { type: String, required: true, default: 'A', index: true },
    status: { type: String, required: true, default: 'A' },
    method: { type: String, enum: ['QR_SCAN', 'MANUAL_ID'], default: 'QR_SCAN' },
    scannedAt: { type: Date, default: Date.now },
    markedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

// Prevent duplicate attendance for the same shift and date using qrId and traineeId
attendanceSchema.index(
  { qrId: 1, date: 1, shift: 1 },
  {
    unique: true,
    partialFilterExpression: { qrId: { $type: 'string', $gt: '' } },
  }
);
attendanceSchema.index(
  { traineeId: 1, date: 1, shift: 1 },
  {
    unique: true,
    partialFilterExpression: { traineeId: { $type: 'string', $gt: '' } },
  }
);

export const Attendance = mongoose.model('Attendance', attendanceSchema);
