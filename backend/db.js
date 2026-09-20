// db.js — repository shim for the prototype. The legacy JSON data layer remains
// available in db.legacy.js for rollback, while the route-level helpers below
// provide the specific application-query functions expected by the Postgres-era
// API contract without forcing a risky wholesale rewrite of the route logic.
const fs = require('fs');
const path = require('path');

const { encrypt, decrypt } = require('./crypto');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
const LOCK_FILE = `${DB_FILE}.lock`;

const DEFAULT_DB = {
  users: [],          // {id, name, role: citizen|officer|admin, department_id, aadhaar, mobile, email, passwordHash}
  departments: [],     // {id, name, code}
  services: [],        // {id, department_id, name, workflow: [stage names...], slaHours, eligibility: []}
  applications: [],    // {id, citizenId, serviceId, departmentId, status, currentStageIndex, data, createdAt, updatedAt, history:[]}
  consents: [],        // {id, citizenId, departmentId, fieldsCovered: [], purpose, grantedAt, expiresAt, status}
  auditLogs: [],       // {id, actor, actorRole, action, entity, entityId, timestamp, details}
  notifications: [],   // {id, citizenId|departmentId, message, channel, status, createdAt}
  connectorLogs: [],   // {id, connector, request, response, timestamp, status}
  grievances: [],      // reserved for the grievance module
  dataQualityFlags: [], // {id, type, candidateIds, reason, status, createdAt, resolvedAt, resolvedBy}
  dataAccessLogs: [],  // {id, actor, actorRole, requestingDepartmentId, citizenId, fieldsCovered, consentId, timestamp}
  verifiedDocuments: [] // {id, citizenId, docType, verifiedBy, verifiedAt, expiresAt}
};

function load() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
  let db;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (error) {
    throw new Error(`Database file is not valid JSON: ${DB_FILE}. ${error.message}`);
  }
  for (const [collection, defaultValue] of Object.entries(DEFAULT_DB)) {
    if (!Array.isArray(db[collection])) db[collection] = Array.isArray(defaultValue) ? [] : defaultValue;
  }
  // Decrypt user Aadhaar values in memory
  if (Array.isArray(db.users)) {
    for (const u of db.users) {
      if (u.aadhaar && typeof u.aadhaar === 'string' && u.aadhaar.startsWith('enc:')) {
        u.aadhaar = decrypt(u.aadhaar);
      }
    }
  }
  return db;
}

function save(db) {
  const temporaryFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  let lockHandle;

  // Clone DB object to encrypt user Aadhaar values before writing to file
  const copy = JSON.parse(JSON.stringify(db));
  if (Array.isArray(copy.users)) {
    for (const u of copy.users) {
      if (u.aadhaar && typeof u.aadhaar === 'string' && !u.aadhaar.startsWith('enc:')) {
        u.aadhaar = encrypt(u.aadhaar);
      }
    }
  }

  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        lockHandle = fs.openSync(LOCK_FILE, 'wx');
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const waitUntil = Date.now() + 10;
        while (Date.now() < waitUntil) {}
      }
    }
    if (!lockHandle) throw new Error('Could not acquire database write lock');
    fs.writeFileSync(temporaryFile, JSON.stringify(copy, null, 2), 'utf-8');
    fs.renameSync(temporaryFile, DB_FILE);
  } finally {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    if (lockHandle) {
      fs.closeSync(lockHandle);
      if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
    }
  }
}

function getApplicationById(id, db = load()) {
  return db.applications.find(application => application.id === id) || null;
}

function insertApplication(application, db = load()) {
  db.applications.push(application);
  save(db);
  return application;
}

function advanceApplicationStage(id, newIndex, db = load()) {
  const application = db.applications.find(item => item.id === id);
  if (!application) return null;
  application.currentStageIndex = newIndex;
  application.updatedAt = new Date().toISOString();
  save(db);
  return application;
}

module.exports = { load, save, DEFAULT_DB, getApplicationById, insertApplication, advanceApplicationStage };
