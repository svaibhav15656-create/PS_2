const express = require('express');
const { load } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Unified citizen search endpoint (by Aadhaar, Mobile, or ID)
router.get('/lookup', requireAuth, requireRole('officer', 'admin'), (req, res) => {
  const query = String(req.query.query || '').trim().toLowerCase();
  if (!query) return res.status(400).json({ error: 'query parameter is required' });

  const db = load();
  const matches = db.users
    .filter(u => u.role === 'citizen' && u.status !== 'merged')
    .filter(u => (
      u.id === query ||
      (u.aadhaar && u.aadhaar.replace(/\D/g, '').includes(query.replace(/\D/g, ''))) ||
      (u.mobile && u.mobile.includes(query)) ||
      (u.email && u.email.toLowerCase().includes(query)) ||
      (u.name && u.name.toLowerCase().includes(query))
    ))
    .map(u => ({ id: u.id, name: u.name, aadhaar: u.aadhaar ? `XXXX-XXXX-${u.aadhaar.slice(-4)}` : null, mobile: u.mobile, email: u.email }));

  res.json(matches);
});

// The "golden record": one consolidated view of a citizen across every
// department — applications, consents, notifications — pulled together by
// the MDM layer instead of living in silos.
router.get('/:id/golden-record', requireAuth, (req, res) => {
  const { id } = req.params;
  if (req.user.role === 'citizen' && req.user.id !== id) {
    return res.status(403).json({ error: 'Citizens may only view their own record' });
  }
  const db = load();
  const citizen = db.users.find(u => u.id === id && u.role === 'citizen');
  if (!citizen) return res.status(404).json({ error: 'Citizen not found' });

  let applications = db.applications.filter(a => a.citizenId === id).map(a => enrich(a, db));
  const consents = db.consents.filter(c => c.citizenId === id);
  const notifications = db.notifications.filter(n => n.citizenId === id);

  let crossDeptConsentGranted = true;
  if (req.user.role === 'officer') {
    const activeConsent = consents.find(c => c.departmentId === req.user.departmentId && c.status === 'granted' && new Date(c.expiresAt) > new Date());
    if (!activeConsent) {
      crossDeptConsentGranted = false;
      // Filter out applications belonging to other departments if no consent
      applications = applications.map(a => {
        if (a.departmentId === req.user.departmentId) return a;
        return {
          id: a.id,
          serviceName: a.serviceName,
          departmentName: a.departmentName,
          status: a.status,
          createdAt: a.createdAt,
          data: { note: 'Cross-department data access requires citizen consent' },
          restricted: true
        };
      });
    } else {
      const { logDataAccess } = require('../dataAccessLog');
      const { save } = require('../db');
      logDataAccess(db, {
        actor: req.user.name,
        actorRole: req.user.role,
        requestingDepartmentId: req.user.departmentId,
        citizenId: id,
        fieldsCovered: activeConsent.fieldsCovered || ['goldenRecord'],
        consentId: activeConsent.id
      });
      save(db);
    }
  }

  res.json({
    citizen: { id: citizen.id, name: citizen.name, aadhaar: citizen.aadhaar, mobile: citizen.mobile, email: citizen.email, status: citizen.status },
    applications,
    consents,
    notifications: req.user.role === 'citizen' ? notifications : undefined,
    crossDeptConsentGranted,
    summary: {
      totalApplications: applications.length,
      pending: applications.filter(a => a.status === 'In Progress').length,
      completed: applications.filter(a => a.status === 'Completed').length
    }
  });
});

function enrich(app, db) {
  const service = db.services.find(s => s.id === app.serviceId);
  const dept = db.departments.find(d => d.id === app.departmentId);
  return { ...app, serviceName: service?.name, departmentName: dept?.name, workflow: service?.workflow };
}

module.exports = router;

