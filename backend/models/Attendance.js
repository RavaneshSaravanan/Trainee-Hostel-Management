import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    traineeId: { type: String, required: true },
    date: { type: String, required: true },
    status: { type: String, required: true },
    markedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

attendanceSchema.index({ traineeId: 1, date: 1 }, { unique: true });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
