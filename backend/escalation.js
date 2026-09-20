const { randomUUID } = require('crypto');
const { logAction } = require('./audit');

function checkSlaBreaches(db) {
  const now = new Date();
  let changed = false;
  db.applications.forEach(app => {
    if (app.status !== 'In Progress') return;
    const service = db.services.find(item => item.id === app.serviceId);
    const slaMs = (service?.slaHours || 72) * 3600000;
    const createdAtMs = new Date(app.createdAt).getTime();
    const elapsed = now.getTime() - createdAtMs;

    // Flag at-risk applications (elapsed time >= 70% of SLA duration)
    const isAtRisk = elapsed >= (slaMs * 0.7) && elapsed < slaMs;
    if (app.atRisk !== isAtRisk) {
      app.atRisk = isAtRisk;
      changed = true;
    }

    if (app.escalated) return;
    const deadline = new Date(createdAtMs + slaMs);
    if (now <= deadline) return;
    app.escalated = true;
    app.escalatedAt = now.toISOString();
    app.history.push({ stage: app.history[app.history.length - 1]?.stage || 'Escalated', at: app.escalatedAt, by: 'SetuOne SLA monitor', note: 'SLA breach escalated for officer review' });
    db.notifications.push({ id: randomUUID(), departmentId: app.departmentId, message: `Application ${app.id.slice(0, 8)} has breached its SLA and was escalated.`, channel: 'in-app', status: 'sent', createdAt: app.escalatedAt });
    logAction(db, { actor: 'SetuOne SLA monitor', actorRole: 'system', action: 'SLA_ESCALATED', entity: 'application', entityId: app.id, details: { departmentId: app.departmentId } });
    changed = true;
  });
  return changed;
}

module.exports = { checkSlaBreaches };