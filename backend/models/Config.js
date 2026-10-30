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
    orgBranding: {
      orgName: { type: String, default: 'APOLLO TYRES LTD' },
      logo: { type: String, default: '' },
      tagline: { type: String, default: 'Hostel Administration & Trainee Operations' },
      address: { type: String, default: '' },
    },
    idCardTemplate: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    emailTemplate: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    approvalConfig: {
      approvers: {
        type: [
          {
            userId: { type: String, required: true },
            name: { type: String, default: '' },
            username: { type: String, default: '' },
            email: { type: String, default: '' },
            roleId: { type: String, default: '' },
          },
        ],
        default: () => [],
      },
      policy: {
        type: String,
        enum: ['ANY_ONE', 'MAJORITY', 'ALL'],
        default: 'ANY_ONE',
      },
      configuredAt: { type: Date },
      configuredBy: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

export const Config = mongoose.model('Config', configSchema);
