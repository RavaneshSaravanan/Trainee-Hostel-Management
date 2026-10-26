import mongoose from 'mongoose';

const dailySummarySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, index: true },
    started: { type: Boolean, default: false },
    startedBy: { type: String, default: '' },
    startedAt: { type: String, default: '' },
    manual: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    savedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

export const DailySummary = mongoose.model('DailySummary', dailySummarySchema);
