import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    traineeId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    shift: { type: String, required: true, default: 'A', index: true },
    status: { type: String, required: true, default: 'A' },
    method: { type: String, enum: ['QR_SCAN', 'MANUAL_ID'], default: 'QR_SCAN' },
    scannedAt: { type: Date, default: Date.now },
    markedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

// One trainee can have only one attendance record for the same shift on the same attendance date
attendanceSchema.index({ traineeId: 1, date: 1, shift: 1 }, { unique: true });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
