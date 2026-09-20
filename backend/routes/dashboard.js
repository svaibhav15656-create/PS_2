const express = require('express');
const { load } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/stats', requireAuth, requireRole('admin', 'officer'), (req, res) => {
  const db = load();
  const apps = req.user.role === 'officer'
    ? db.applications.filter(a => a.departmentId === req.user.departmentId)
    : db.applications;

  const total = apps.length;
  const completed = apps.filter(a => a.status === 'Completed').length;
  const rejected = apps.filter(a => a.status === 'Rejected').length;
  const inProgress = apps.filter(a => a.status === 'In Progress').length;

  const withSla = apps.map(a => {
    const service = db.services.find(s => s.id === a.serviceId);
    const deadline = new Date(new Date(a.createdAt).getTime() + (service?.slaHours || 72) * 3600000);
    return { ...a, breached: a.status !== 'Completed' && new Date() > deadline };
  });
  const breached = withSla.filter(a => a.breached).length;
  const grievances = (db.grievances || []).filter(grievance => {
    if (req.user.role === 'officer') return grievance.departmentId === req.user.departmentId;
    return true;
  });
  const grievanceBreached = grievances.filter(grievance => {
    if (grievance.status === 'Resolved') return false;
    const deadline = new Date(new Date(grievance.createdAt).getTime() + 72 * 3600000);
    return new Date() > deadline;
  }).length;

  const byDepartment = {};
  for (const a of apps) {
    const dept = db.departments.find(d => d.id === a.departmentId)?.name || 'Unknown';
    byDepartment[dept] = byDepartment[dept] || { total: 0, completed: 0 };
    byDepartment[dept].total++;
    if (a.status === 'Completed') byDepartment[dept].completed++;
  }

  res.json({
    total,
    completed,
    rejected,
    inProgress,
    slaBreached: breached,
    atRiskCount: apps.filter(a => a.atRisk).length,
    escalatedCount: apps.filter(a => a.escalated).length,
    slaCompliancePct: total ? Math.round(((total - breached) / total) * 100) : 100,
    grievances: {
      total: grievances.length,
      open: grievances.filter(grievance => grievance.status !== 'Resolved').length,
      resolved: grievances.filter(grievance => grievance.status === 'Resolved').length,
      slaBreached: grievanceBreached
    },
    byDepartment,
    duplicateSubmissionsPrevented: db.connectorLogs.filter(l => l.connector === 'aadhaar' && l.status === 'success').length,
    documentReusesCount: (db.applications || []).filter(a => a.consentUsed || a.data?.annualIncomeSource === 'consent').length,
    connectorCallsTotal: db.connectorLogs.length
  });
});

module.exports = router;
