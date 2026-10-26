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
    address1: { type: String, default: '' },
    district: { type: String, default: '' },
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
  },
  { timestamps: true }
);

export const Trainee = mongoose.model('Trainee', traineeSchema);
