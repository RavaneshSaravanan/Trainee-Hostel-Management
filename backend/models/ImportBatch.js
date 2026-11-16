import mongoose from 'mongoose';

const importBatchSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true, index: true },
    originalFilename: { type: String, default: '' },
    uploadedBy: { type: String, default: '' },
    uploadedByName: { type: String, default: '' },
    uploadDate: { type: Date, default: Date.now },
    totalRows: { type: Number, default: 0 },
    successfulCount: { type: Number, default: 0 },
    partialCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    roomAllocatedCount: { type: Number, default: 0 },
    roomPendingCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['COMPLETED', 'PARTIAL', 'FAILED'],
      default: 'COMPLETED',
    },
    records: [
      {
        rowNumber: Number,
        traineeId: String,
        qrId: String,
        name: String,
        status: String,
        hostel: String,
        roomNo: String,
        completionStatus: String,
        missingFields: [String],
        roomStatus: String,
        warnings: [String],
      },
    ],
    errors: [
      {
        rowNumber: Number,
        traineeName: String,
        field: String,
        originalValue: String,
        error: String,
        result: String,
        suggestion: String,
      },
    ],
    emailDeliverySummary: {
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      deferred: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export const ImportBatch = mongoose.model('ImportBatch', importBatchSchema);
