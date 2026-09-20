const express = require('express');
const { randomUUID } = require('crypto');
const { load, save } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../audit');
const { isNonEmptyString } = require('../validation');

const router = express.Router();

function validateService(body) {
  const errors = [];
  if (!isNonEmptyString(body.name)) errors.push({ field: 'name', message: 'name is required' });
  if (!isNonEmptyString(body.departmentId)) errors.push({ field: 'departmentId', message: 'departmentId is required' });
  if (!Array.isArray(body.workflow) || body.workflow.length === 0 || body.workflow.some(stage => !isNonEmptyString(stage))) {
    errors.push({ field: 'workflow', message: 'workflow must contain at least one non-empty stage' });
  }
  if (!Number.isFinite(body.slaHours) || body.slaHours <= 0) errors.push({ field: 'slaHours', message: 'slaHours must be a positive number' });
  if (!Array.isArray(body.requiredFields) || body.requiredFields.some(field => !isNonEmptyString(field))) errors.push({ field: 'requiredFields', message: 'requiredFields must be an array of field names' });
  return errors;
}

router.post('/services', requireAuth, requireRole('admin'), (req, res) => {
  const errors = validateService(req.body || {});
  if (errors.length) return res.status(400).json({ error: 'Invalid service data', details: errors });
  const db = load();
  if (!db.departments.some(department => department.id === req.body.departmentId)) return res.status(400).json({ error: 'Unknown department' });
  const service = { id: randomUUID(), name: req.body.name.trim(), departmentId: req.body.departmentId, workflow: req.body.workflow.map(stage => stage.trim()), slaHours: req.body.slaHours, requiredFields: req.body.requiredFields.map(field => field.trim()) };
  db.services.push(service);
  logAction(db, { actor: req.user.name, actorRole: req.user.role, action: 'SERVICE_CREATED', entity: 'service', entityId: service.id });
  save(db);
  res.status(201).json(service);
});

router.patch('/services/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db = load();
  const service = db.services.find(item => item.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  if (db.applications.some(application => application.serviceId === service.id)) return res.status(409).json({ error: 'Service cannot be edited after applications have been created for it' });
  const next = { ...service, ...req.body };
  const errors = validateService(next);
  if (errors.length) return res.status(400).json({ error: 'Invalid service data', details: errors });
  Object.assign(service, { name: next.name.trim(), departmentId: next.departmentId, workflow: next.workflow.map(stage => stage.trim()), slaHours: next.slaHours, requiredFields: next.requiredFields.map(field => field.trim()) });
  logAction(db, { actor: req.user.name, actorRole: req.user.role, action: 'SERVICE_UPDATED', entity: 'service', entityId: service.id });
  save(db);
  res.json(service);
});

router.get('/data-quality/duplicates', requireAuth, requireRole('admin'), (req, res) => {
  const db = load();
  const citizens = new Map(db.users.filter(user => user.role === 'citizen').map(user => [user.id, user]));
  const flags = db.dataQualityFlags.filter(flag => flag.status === 'open').map(flag => ({
    ...flag,
    candidates: flag.candidateIds.map(id => {
      const user = citizens.get(id);
      return user ? { id: user.id, name: user.name, email: user.email, mobile: user.mobile, dateOfBirth: user.dateOfBirth } : null;
    }).filter(Boolean)
  }));
  res.json(flags);
});

router.patch('/data-quality/duplicates/:id/resolve', requireAuth, requireRole('admin'), (req, res) => {
  const db = load();
  const flag = db.dataQualityFlags.find(item => item.id === req.params.id);
  if (!flag) return res.status(404).json({ error: 'Data-quality flag not found' });
  if (flag.status !== 'open') return res.status(409).json({ error: 'Data-quality flag is already resolved' });
  flag.status = 'resolved';
  flag.resolvedAt = new Date().toISOString();
  flag.resolvedBy = req.user.id;
  logAction(db, { actor: req.user.name, actorRole: req.user.role, action: 'DATA_QUALITY_FLAG_RESOLVED', entity: 'dataQualityFlag', entityId: flag.id });
  save(db);
  res.json(flag);
});

const { mergeDuplicateCitizens } = require('../mdm');

router.post('/data-quality/merge', requireAuth, requireRole('admin'), (req, res) => {
  const { primaryId, duplicateId } = req.body || {};
  if (!primaryId || !duplicateId) return res.status(400).json({ error: 'primaryId and duplicateId are required' });
  if (primaryId === duplicateId) return res.status(400).json({ error: 'primaryId and duplicateId cannot be identical' });

  const db = load();
  const result = mergeDuplicateCitizens(db, primaryId, duplicateId);
  if (result.error) return res.status(400).json(result);

  logAction(db, { actor: req.user.name, actorRole: req.user.role, action: 'CITIZENS_MERGED', entity: 'citizen', entityId: primaryId, details: { duplicateId } });
  save(db);
  res.json(result);
});

module.exports = router;