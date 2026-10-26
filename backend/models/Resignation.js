import mongoose from 'mongoose';

const resignationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    traineeId: { type: String, required: true, index: true },
    resignationDate: { type: String, default: '' },
    lastWorkingDate: { type: String, default: '' },
    reason: { type: String, default: '' },
    status: { type: String, default: 'PENDING' },
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Resignation = mongoose.model('Resignation', resignationSchema);
