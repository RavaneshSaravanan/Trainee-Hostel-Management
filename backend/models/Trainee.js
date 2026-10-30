import mongoose from 'mongoose';

const traineeSchema = new mongoose.Schema(
  {
    traineeId: { type: String, required: true, unique: true, index: true },
    hostelId: { type: String, default: '' },
    qrId: { type: String, default: '' },
    qrStatus: { type: String, default: 'ACTIVE' },
    name: { type: String, required: true },
    mobile: { type: String, default: '' },
    email: { type: String, default: '' },
    dob: { type: String, default: '' },
    gender: { type: String, default: '' },
    qualification: { type: String, default: '' },
    aadhar: { type: String, default: '' },
    food: { type: String, default: '' },
    photo: { type: String, default: '' },
    photoDriveId: { type: String, default: '', index: true },
    photoDriveUrl: { type: String, default: '' },
    photoDriveMimeType: { type: String, default: 'image/jpeg' },
    photoDriveSize: { type: Number, default: 0 },
    photoDriveUpdatedAt: { type: Date },
    address1: { type: String, default: '' },
    state: { type: String, default: '' },
    guardianName: { type: String, default: '' },
    guardianContact: { type: String, default: '' },
    joiningDate: { type: String, default: '' },
    defaultShift: { type: String, default: 'G' },
    employmentStatus: { type: String, default: 'ACTIVE' },
    hostelStatus: { type: String, default: 'PENDING REVIEW' },
    hostel: { type: String, default: '' },
    roomNo: { type: String, default: '' },
    remarks: { type: String, default: '' },
    submissionDate: { type: String, default: '' },
    approvedBy: { type: String, default: '' },
    custom: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // Approval workflow
    approvalStatus: {
      type: String,
      enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
      default: 'PENDING_APPROVAL',
      index: true,
    },
    approvals: {
      type: [
        {
          approverId: String,
          approverName: String,
          decision: { type: String, enum: ['APPROVED', 'REJECTED'] },
          rejectionReason: String,
          timestamp: { type: Date, default: Date.now },
        },
      ],
      default: () => [],
    },
    rejectionReason: { type: String, default: '' },

    // Free-Stay Validity & Payment
    freeStayExpiryDate: { type: String, default: '', index: true },
    paymentStatus: {
      type: String,
      enum: ['FREE', 'EXPIRING_SOON', 'EXPIRED_DUE', 'PAID'],
      default: 'FREE',
      index: true,
    },
    paymentHistory: {
      type: [
        {
          paymentDate: String,
          amount: Number,
          receiptNo: String,
          notes: String,
          recordedBy: String,
          recordedAt: { type: Date, default: Date.now },
        },
      ],
      default: () => [],
    },

    // ID Card Issuance tracking
    idCardIssued: { type: Boolean, default: false },
    idCardIssuedAt: { type: Date },
  },
  { timestamps: true }
);

// Unique partial index on aadhar: duplicate aadhar is strictly not allowed if non-empty
traineeSchema.index(
  { aadhar: 1 },
  {
    unique: true,
    partialFilterExpression: {
      aadhar: { $type: 'string', $gt: '' },
    },
  }
);

export const Trainee = mongoose.model('Trainee', traineeSchema);
