import mongoose from 'mongoose';

const metaSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'state_rev', unique: true, index: true },
    rev: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export const Meta = mongoose.model('Meta', metaSchema);

export async function getRev() {
  let meta = await Meta.findOne({ key: 'state_rev' });
  if (!meta) {
    meta = await Meta.create({ key: 'state_rev', rev: 1 });
  }
  return meta.rev;
}

export async function bumpRev() {
  const meta = await Meta.findOneAndUpdate(
    { key: 'state_rev' },
    { $inc: { rev: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return meta.rev;
}
