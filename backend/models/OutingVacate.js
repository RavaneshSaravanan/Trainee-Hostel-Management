import mongoose from 'mongoose';

const outingVacateSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    traineeId: { type: String, required: true, index: true },
    date: { type: String, default: '' },
    type: { type: String, required: true },
    fromDate: { type: String, default: '' },
    expectedReturn: { type: String, default: '' },
    reason: { type: String, default: '' },
    status: { type: String, default: 'PENDING' },
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

export const OutingVacate = mongoose.model('OutingVacate', outingVacateSchema);
