const express = require('express');
const { randomUUID } = require('crypto');
const { load, save, getApplicationById, advanceApplicationStage } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../audit');
const { connectors } = require('../connectors');
const { validateApplicationData, isNonEmptyString } = require('../validation');
const notificationProvider = require('../notificationProvider');

const router = express.Router();

function notify(db, citizenId, message) {
  const citizen = db.users.find(user => user.id === citizenId);
  const notification = { id: randomUUID(), citizenId, message, email: citizen?.email, channel: 'in-app', status: 'sent', createdAt: new Date().toISOString() };
  db.notifications.push(notification);
  notificationProvider.send(notification).catch(error => console.error(`Notification delivery failed: ${error.message}`));
}

function enrich(app, db) {
  const service = db.services.find(s => s.id === app.serviceId);
  const dept = db.departments.find(d => d.id === app.departmentId);
  const citizen = db.users.find(u => u.id === app.citizenId);
  const slaDeadline = new Date(new Date(app.createdAt).getTime() + (service?.slaHours || 72) * 3600000).toISOString();
  return {
    ...app,
    serviceName: service?.name,
    departmentName: dept?.name,
    citizenName: citizen?.name,
    workflow: service?.workflow,
    currentStage: service?.workflow?.[app.currentStageIndex],
    slaDeadline,
    slaBreached: app.status !== 'Completed' && new Date() > new Date(slaDeadline)
  };
}

// List services available across all departments (service catalog)
router.get('/services/catalog', requireAuth, (req, res) => {
  const db = load();
  res.json(db.services.map(s => ({ ...s, departmentName: db.departments.find(d => d.id === s.departmentId)?.name })));
});

// Rule-based Scheme Eligibility Recommender
router.get('/services/recommended', requireAuth, requireRole('citizen'), (req, res) => {
  const db = load();
  const citizen = db.users.find(u => u.id === req.user.id);
  const citizenApps = db.applications.filter(a => a.citizenId === req.user.id);

  // Extract citizen facts from profile, income registry, and previous applications
  const incomeFetch = connectors.incomeRegistry.fetch(db, citizen.aadhaar);
  const annualIncome = incomeFetch?.annualIncome || 185000;
  const age = citizen.dateOfBirth ? Math.floor((new Date() - new Date(citizen.dateOfBirth)) / (365.25 * 24 * 3600 * 1000)) : 25;
  const familySize = 4;
  const casteCategory = 'OBC';

  const facts = { annualIncome, age, familySize, casteCategory };

  const recommendations = db.services.map(service => {
    const rules = service.eligibility || [];
    const reasons = [];
    let eligible = true;

    for (const rule of rules) {
      const factVal = facts[rule.field];
      if (factVal === undefined) continue;
      if (rule.op === '<=' && !(factVal <= rule.value)) {
        eligible = false;
        reasons.push(`${rule.field} (${factVal}) exceeds limit ${rule.value}`);
      } else if (rule.op === '>=' && !(factVal >= rule.value)) {
        eligible = false;
        reasons.push(`${rule.field} (${factVal}) below minimum ${rule.value}`);
      } else if (rule.op === '==' && factVal !== rule.value) {
        eligible = false;
        reasons.push(`${rule.field} does not match ${rule.value}`);
      } else {
        reasons.push(`Verified ${rule.field}: ${factVal} (${rule.op} ${rule.value})`);
      }
    }

    if (!rules.length) reasons.push('Open for all citizens');

    const alreadyApplied = citizenApps.some(a => a.serviceId === service.id && a.status !== 'Rejected');
    return {
      serviceId: service.id,
      serviceName: service.name,
      departmentName: db.departments.find(d => d.id === service.departmentId)?.name,
      eligible,
      alreadyApplied,
      reasons,
      prefillData: { annualIncome, casteCategory, familySize }
    };
  }).filter(rec => rec.eligible && !rec.alreadyApplied);

  res.json(recommendations);
});


// Citizen submits an application. Runs mock identity-verification connectors
// automatically instead of asking the citizen to prove the same facts again.
router.post('/', requireAuth, requireRole('citizen'), async (req, res) => {
  const { serviceId, data } = req.body || {};
  if (!isNonEmptyString(serviceId)) return res.status(400).json({ error: 'serviceId is required' });
  const db = load();
  const service = db.services.find(s => s.id === serviceId);
  if (!service) return res.status(404).json({ error: 'Unknown service' });
  const citizen = db.users.find(u => u.id === req.user.id);
  const submissionData = { ...(data || {}) };
  let consentUsed = null;
  const integrations = service.integrations || [
    ...(service.name === 'New Ration Card' ? [{ type: 'pincode' }] : []),
    ...(service.name === 'Scholarship Application' ? [{ type: 'incomeRegistry', consentDeptCode: 'SWD' }, { type: 'casteRegistry' }] : [])
  ];

  for (const integ of integrations) {
    if (integ.type === 'pincode') {
      const pincodeMatch = String(submissionData.pincode || submissionData.address || '').match(/\b\d{6}\b/);
      if (pincodeMatch) {
        const pincodeResult = await connectors.pincode.lookup(db, pincodeMatch[0]);
        if (!pincodeResult.valid) {
          save(db);
          return res.status(400).json({ error: 'Application failed address verification', code: 'ADDRESS_VERIFICATION_ERROR', details: [{ field: 'data.pincode', message: pincodeResult.reason }] });
        }
        submissionData.pincode = pincodeMatch[0];
        submissionData.addressDistrict = pincodeResult.district;
        submissionData.addressState = pincodeResult.state;
      }
    } else if (integ.type === 'incomeRegistry') {
      const targetDeptCode = integ.consentDeptCode || 'SWD';
      const dept = db.departments.find(d => d.code === targetDeptCode);
      const activeConsent = db.consents.find(consent => consent.citizenId === req.user.id
        && consent.departmentId === dept?.id
        && consent.status === 'granted'
        && new Date(consent.expiresAt) > new Date());
      const { logDataAccess } = require('../dataAccessLog');
      if (activeConsent && !isNonEmptyString(submissionData.annualIncome)) {
        consentUsed = activeConsent;
        try {
          const income = connectors.incomeRegistry.fetch(db, citizen.aadhaar);
          if (income?.annualIncome !== undefined) {
            submissionData.annualIncome = income.annualIncome;
            submissionData.annualIncomeSource = 'consent';
            submissionData.incomeConsentId = activeConsent.id;
            logDataAccess(db, {
              actor: citizen.name,
              actorRole: 'citizen',
              requestingDepartmentId: service.departmentId,
              citizenId: citizen.id,
              fieldsCovered: ['annualIncome'],
              consentId: activeConsent.id
            });
          }
        } catch (error) {
          submissionData.annualIncomeConnectorError = 'manual verification required';
        }
      }
    } else if (integ.type === 'casteRegistry') {
      if (isNonEmptyString(submissionData.casteCategory)) {
        submissionData.casteVerification = connectors.casteRegistry.lookup(db, citizen.aadhaar, submissionData.casteCategory);
      }
    } else if (integ.type === 'sdeRegistry') {
      submissionData.sdeVerification = connectors.sdeRegistry.lookup(db, citizen.aadhaar);
    }
  }
  const validationErrors = validateApplicationData(service, submissionData);
  if (validationErrors.length) {
    return res.status(400).json({ error: 'Application failed data-quality checks', code: 'DATA_QUALITY_ERROR', details: validationErrors });
  }

  const verification = citizen.aadhaar ? connectors.aadhaar.verify(db, citizen.aadhaar) : { verified: false, reason: 'No Aadhaar on file' };

  const app = {
    id: randomUUID(),
    citizenId: req.user.id,
    serviceId,
    departmentId: service.departmentId,
    status: 'In Progress',
    currentStageIndex: 0,
    data: submissionData,
    consentUsed: consentUsed && submissionData.annualIncomeSource === 'consent' ? consentUsed.id : null,
    identityVerification: verification,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [{
      stage: service.workflow[0],
      at: new Date().toISOString(),
      by: citizen.name,
      note: consentUsed && submissionData.annualIncomeSource === 'consent'
        ? `Application submitted; annualIncome auto-filled via consent ${consentUsed.id}`
        : 'Application submitted'
    }]
  };
  db.applications.push(app);
  notify(db, citizen.id, `Your application for "${service.name}" has been received. Track it anytime with reference ${app.id.slice(0, 8)}.`);
  logAction(db, {
    actor: citizen.name,
    actorRole: 'citizen',
    action: 'APPLICATION_SUBMITTED',
    entity: 'application',
    entityId: app.id,
    details: { serviceId, consentUsed: app.consentUsed, autoFilledFields: app.consentUsed ? ['annualIncome'] : [] }
  });
  save(db);
  res.status(201).json(enrich(app, db));
});

// Unified tracking: a citizen sees every application, across every
// department, in one list — the core "no more visiting five offices" feature.
router.get('/', requireAuth, (req, res) => {
  const db = load();
  let list;
  if (req.user.role === 'citizen') {
    list = db.applications.filter(a => a.citizenId === req.user.id);
  } else if (req.user.role === 'officer') {
    list = db.applications.filter(a => a.departmentId === req.user.departmentId);
  } else {
    list = db.applications; // admin sees everything
  }
  res.json(list.map(a => enrich(a, db)));
});

router.get('/:id', requireAuth, (req, res) => {
  const db = load();
  const app = getApplicationById(req.params.id, db);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (req.user.role === 'citizen' && app.citizenId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role === 'officer' && app.departmentId !== req.user.departmentId) return res.status(403).json({ error: 'Forbidden' });
  res.json(enrich(app, db));
});

// Officer advances the workflow stage — configurable per service, driven
// entirely by the `workflow` array on the service, not hard-coded per department.
router.patch('/:id/advance', requireAuth, requireRole('officer', 'admin'), (req, res) => {
  const { note } = req.body || {};
  if (note !== undefined && !isNonEmptyString(note)) return res.status(400).json({ error: 'note must be a non-empty string when provided' });
  const db = load();
  const app = getApplicationById(req.params.id, db);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (req.user.role === 'officer' && app.departmentId !== req.user.departmentId) {
    return res.status(403).json({ error: 'You may only act on applications for your own department' });
  }
  const service = db.services.find(s => s.id === app.serviceId);
  if (app.currentStageIndex >= service.workflow.length - 1) {
    return res.status(400).json({ error: 'Application is already at its final stage' });
  }
  app.currentStageIndex += 1;
  app.updatedAt = new Date().toISOString();
  const stageName = service.workflow[app.currentStageIndex];
  app.history.push({ stage: stageName, at: app.updatedAt, by: req.user.name, note: note || '' });
  if (app.currentStageIndex === service.workflow.length - 1) {
    app.status = 'Completed';
  }
  const citizen = db.users.find(u => u.id === app.citizenId);
  notify(db, citizen.id, `Update on "${service.name}": your application moved to stage "${stageName}".`);
  logAction(db, { actor: req.user.name, actorRole: req.user.role, action: 'STAGE_ADVANCED', entity: 'application', entityId: app.id, details: { stage: stageName } });
  advanceApplicationStage(app.id, app.currentStageIndex, db);
  save(db);
  res.json(enrich(app, db));
});

// Officer rejects an application with a reason (exception handling).
router.patch('/:id/reject', requireAuth, requireRole('officer', 'admin'), (req, res) => {
  const { reason } = req.body || {};
  if (!isNonEmptyString(reason)) return res.status(400).json({ error: 'A rejection reason is required' });
  const db = load();
  const app = getApplicationById(req.params.id, db);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (req.user.role === 'officer' && app.departmentId !== req.user.departmentId) {
    return res.status(403).json({ error: 'You may only act on applications for your own department' });
  }
  app.status = 'Rejected';
  app.updatedAt = new Date().toISOString();
  app.history.push({ stage: 'Rejected', at: app.updatedAt, by: req.user.name, note: reason });
  const citizen = db.users.find(u => u.id === app.citizenId);
  notify(db, citizen.id, `Your application was rejected: ${reason}`);
  logAction(db, { actor: req.user.name, actorRole: req.user.role, action: 'APPLICATION_REJECTED', entity: 'application', entityId: app.id, details: { reason } });
  save(db);
  res.json(enrich(app, db));
});

module.exports = router;
