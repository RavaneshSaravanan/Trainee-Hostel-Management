import mongoose from 'mongoose';

const configSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true, index: true },
    appName: { type: String, default: 'Trainee Hostel' },
    appSub: { type: String, default: 'Management System' },
    logo: { type: String, default: '' },
    theme: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    pages: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    widgets: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    customFields: { type: [mongoose.Schema.Types.Mixed], default: () => [] },
    registrationOpen: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Config = mongoose.model('Config', configSchema);
