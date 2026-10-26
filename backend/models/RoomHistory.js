import mongoose from 'mongoose';

const roomHistorySchema = new mongoose.Schema(
  {
    traineeId: { type: String, required: true, index: true },
    prevHostel: { type: String, default: '' },
    prevRoom: { type: String, default: '' },
    newHostel: { type: String, default: '' },
    newRoom: { type: String, default: '' },
    changeDate: { type: String, default: '' },
    changedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

export const RoomHistory = mongoose.model('RoomHistory', roomHistorySchema);
