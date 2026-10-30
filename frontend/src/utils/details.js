// "Are all of this trainee's details filled?"  Green = complete, red = pending.
// Edit REQUIRED to change which fields must be filled. Required custom fields are checked too.
export const REQUIRED = [
  ['name', 'Name'], ['mobile', 'Mobile'], ['dob', 'Date of Birth'], ['gender', 'Gender'], ['qualification', 'Qualification'],
  ['aadhar', 'Aadhar No.'], ['food', 'Food Preference'], ['address1', 'Address'], ['state', 'State'],
  ['guardianName', 'Guardian Name'], ['guardianContact', 'Guardian Contact'], ['photo', 'Photo'],
];
const empty = (v) => v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '—';

export function missingDetails(t, customFields = []) {
  const out = REQUIRED.filter(([k]) => empty(t[k])).map(([, l]) => l);
  customFields.filter((f) => f.required && empty((t.custom || {})[f.id])).forEach((f) => out.push(f.label));
  return out;
}
export const isComplete = (t, cf) => missingDetails(t, cf).length === 0;
