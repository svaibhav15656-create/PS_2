// seed.js — populates demo data: departments, services (with workflow
// stages), a golden citizen record and login accounts for each role.
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { load, save } = require('./db');

const db = load();

if (db.departments.length === 0) {
  const depts = [
    { id: randomUUID(), name: 'Revenue Department', code: 'REV' },
    { id: randomUUID(), name: 'Skill Development & Employment', code: 'SDE' },
    { id: randomUUID(), name: 'Food & Civil Supplies (Ration Card)', code: 'FCS' },
    { id: randomUUID(), name: 'Social Welfare Department', code: 'SWD' }
  ];
  db.departments.push(...depts);

  const [rev, sde, fcs, swd] = depts;
  db.services.push(
    { id: randomUUID(), departmentId: rev.id, name: 'Income Certificate', workflow: ['Submitted', 'Document Verification', 'Tehsildar Approval', 'Certificate Issued'], slaHours: 168, requiredFields: ['annualIncome', 'purpose'], eligibility: [{ field: 'annualIncome', op: '<=', value: 800000 }] },
    { id: randomUUID(), departmentId: sde.id, name: 'Skill Training Enrollment', workflow: ['Submitted', 'Eligibility Check', 'Batch Allotment', 'Enrolled'], slaHours: 72, requiredFields: ['educationLevel', 'preferredTrade'], eligibility: [{ field: 'age', op: '>=', value: 18 }] },
    { id: randomUUID(), departmentId: fcs.id, name: 'New Ration Card', workflow: ['Submitted', 'Field Verification', 'FSO Approval', 'Card Issued'], slaHours: 240, requiredFields: ['familySize', 'address'], eligibility: [{ field: 'familySize', op: '>=', value: 1 }] },
    { id: randomUUID(), departmentId: swd.id, name: 'Scholarship Application', workflow: ['Submitted', 'Income/Caste Validation', 'Committee Review', 'Disbursed'], slaHours: 336, requiredFields: ['annualIncome', 'casteCategory', 'institutionName'], eligibility: [{ field: 'annualIncome', op: '<=', value: 250000 }] }
  );

  const passwordHash = bcrypt.hashSync('password123', 8);
  db.users.push(
    { id: randomUUID(), name: 'Asha Patil', role: 'citizen', aadhaar: '1234-5678-9012', mobile: '9876543210', email: 'asha@example.com', passwordHash },
    { id: randomUUID(), name: 'Rohan Deshmukh', role: 'officer', departmentId: rev.id, email: 'rohan.rev@gov.in', passwordHash },
    { id: randomUUID(), name: 'Neha Kulkarni', role: 'officer', departmentId: sde.id, email: 'neha.sde@gov.in', passwordHash },
    { id: randomUUID(), name: 'Admin User', role: 'admin', email: 'admin@gov.in', passwordHash }
  );

  save(db);
  console.log('Seeded database with demo departments, services and users.');
  console.log('Login with password "password123" for: asha@example.com (citizen), rohan.rev@gov.in (officer), admin@gov.in (admin)');
} else {
  const requiredFieldsByService = {
    'Income Certificate': ['annualIncome', 'purpose'],
    'Skill Training Enrollment': ['educationLevel', 'preferredTrade'],
    'New Ration Card': ['familySize', 'address'],
    'Scholarship Application': ['annualIncome', 'casteCategory', 'institutionName']
  };
  let changed = false;
  db.services.forEach(service => {
    if (!service.requiredFields && requiredFieldsByService[service.name]) {
      service.requiredFields = requiredFieldsByService[service.name];
      changed = true;
    }
  });
  if (changed) save(db);
  console.log('DB already seeded — skipping.');
}
