import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema(
  {
    no: { type: String, required: true },
    capacity: { type: Number, default: 1 },
  },
  { _id: false }
);

const hostelSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    rooms: [roomSchema],
  },
  { timestamps: true }
);

export const Hostel = mongoose.model('Hostel', hostelSchema);
