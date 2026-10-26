import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    system: { type: Boolean, default: false },
    pages: [{ type: String }],
  },
  { timestamps: true }
);

export const Role = mongoose.model('Role', roleSchema);
