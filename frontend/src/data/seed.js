// Empty seed structure — all application data is managed directly in MongoDB.
export function createSeed() {
  return {
    hostels: [],
    trainees: [],
    attendance: [],
    leaves: [],
    outingVacate: [],
    resignations: [],
    remarks: [],
    roomHistory: [],
    dailySummary: {},
  };
}
