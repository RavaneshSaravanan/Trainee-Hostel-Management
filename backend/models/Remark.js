import mongoose from 'mongoose';

const remarkSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    traineeId: { type: String, required: true, index: true },
    date: { type: String, default: '' },
    type: { type: String, default: 'REMARK' },
    text: { type: String, default: '' },
    actionTaken: { type: String, default: '' },
    status: { type: String, default: 'OPEN' },
    reportedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Remark = mongoose.model('Remark', remarkSchema);
