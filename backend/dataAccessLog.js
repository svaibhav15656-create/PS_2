const { randomUUID } = require('crypto');

function logDataAccess(db, { actor, actorRole, requestingDepartmentId, citizenId, fieldsCovered, consentId }) {
  if (!db.dataAccessLogs) db.dataAccessLogs = [];
  const entry = {
    id: randomUUID(),
    actor: actor || 'System Gateway',
    actorRole: actorRole || 'system',
    requestingDepartmentId,
    citizenId,
    fieldsCovered: Array.isArray(fieldsCovered) ? fieldsCovered : [fieldsCovered].filter(Boolean),
    consentId: consentId || null,
    timestamp: new Date().toISOString()
  };
  db.dataAccessLogs.push(entry);
  return entry;
}

module.exports = { logDataAccess };
