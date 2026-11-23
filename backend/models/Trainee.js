import mongoose from 'mongoose';

const traineeSchema = new mongoose.Schema(
  {
    traineeId: { type: String, default: '' },
    hostelId: { type: String, default: '' },
    qrId: { type: String, required: true, unique: true, index: true },
    qrStatus: { type: String, default: 'ACTIVE' },
    name: { type: String, required: true },
    mobile: { type: String, default: '' },
    email: { type: String, default: '' },
    passwordHash: { type: String, default: '' },
    dob: { type: String, default: '' },
    gender: { type: String, default: '' },
    qualification: { type: String, default: '' },
    aadhar: { type: String, default: '' },
    aadharMasked: { type: String, default: '' },
    aadharEncrypted: { type: String, default: '' },
    aadharHash: { type: String, default: '' },
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
    employmentStatus: { type: String, default: 'ACTIVE' },
    hostelStatus: { type: String, default: 'PENDING REVIEW' },
    hostel: { type: String, default: '' },
    roomNo: { type: String, default: '' },
    remarks: { type: String, default: '' },
    submissionDate: { type: String, default: '' },
    approvedBy: { type: String, default: '' },
    custom: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // Bulk Import, Partial Registration & Warden Completion
    designation: { type: String, default: '' },
    emergencyContact: { type: String, default: '' },
    completionStatus: {
      type: String,
      enum: ['COMPLETE', 'INCOMPLETE', 'PENDING_DETAILS'],
      default: 'COMPLETE',
      index: true,
    },
    missingFields: { type: [String], default: () => [] },
    roomAllocationStatus: {
      type: String,
      enum: ['ALLOCATED', 'PENDING', 'UNALLOCATED', 'REJECTED_CAPACITY'],
      default: 'UNALLOCATED',
      index: true,
    },
    importBatchId: { type: String, default: '', index: true },
    importRowNumber: { type: Number },
    auditHistory: {
      type: [
        {
          action: String,
          updatedBy: String,
          updatedByName: String,
          updatedFields: [String],
          timestamp: { type: Date, default: Date.now },
          notes: String,
        },
      ],
      default: () => [],
    },

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

    // ID Card Issuance & Email Delivery tracking
    idCardIssued: { type: Boolean, default: false },
    idCardIssuedAt: { type: Date },
    idCardDelivered: { type: Boolean, default: false },
    idCardDeliveredAt: { type: Date },
    idCardDeliveryError: { type: String, default: '' },

    // Welcome Email Delivery tracking
    welcomeEmailSent: { type: Boolean, default: false },
    welcomeEmailSentAt: { type: Date },
    welcomeEmailError: { type: String, default: '' },

    // Approval / Rejection Decision Email Delivery tracking
    approvalEmailSent: { type: Boolean, default: false },
    approvalEmailSentAt: { type: Date },
    approvalEmailError: { type: String, default: '' },

    // Registration Complete Email Delivery tracking
    registrationConfirmationSent: { type: Boolean, default: false },
    registrationConfirmationSentAt: { type: Date },
    registrationConfirmationError: { type: String, default: '' },

    // Email Address Verification tracking
    emailVerified: { type: Boolean, default: false, index: true },
    emailVerifiedAt: { type: Date },

    // Aadhaar Verification status (live integration vs format validation)
    aadhaarVerificationStatus: {
      type: String,
      enum: ['FORMAT_VALIDATED', 'UNVERIFIED', 'VERIFIED'],
      default: 'FORMAT_VALIDATED',
      index: true,
    },
  },
  { timestamps: true }
);

// Unique partial index on traineeId: if specified, duplicate traineeId is strictly not allowed, but empty traineeId is allowed
traineeSchema.index(
  { traineeId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      traineeId: { $type: 'string', $gt: '' },
    },
  }
);

// Unique partial index on aadharHash: duplicate aadhar is strictly not allowed if non-empty
traineeSchema.index(
  { aadharHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      aadharHash: { $type: 'string', $gt: '' },
    },
  }
);

export const Trainee = mongoose.models.Trainee || mongoose.model('Trainee', traineeSchema);
export default Trainee;
