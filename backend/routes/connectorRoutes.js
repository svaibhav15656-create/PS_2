const express = require('express');
const { load, save } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { connectors, maskSensitiveData } = require('../connectors');
const { validateAadhaar, validatePan } = require('../validation');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json(Object.entries(connectors).map(([key, c]) => ({ key, name: c.name })));
});

router.post('/aadhaar/verify', requireAuth, (req, res) => {
  if (!validateAadhaar((req.body || {}).aadhaar)) return res.status(400).json({ error: 'aadhaar must be a valid 12-digit Aadhaar value' });
  const db = load();
  const result = connectors.aadhaar.verify(db, req.body.aadhaar);
  save(db);
  res.json(result);
});

router.post('/pan/verify', requireAuth, (req, res) => {
  if (!validatePan((req.body || {}).pan)) return res.status(400).json({ error: 'pan must be a valid PAN value' });
  const db = load();
  const result = connectors.pan.verify(db, req.body.pan);
  save(db);
  res.json(result);
});

router.post('/pincode/verify', requireAuth, async (req, res) => {
  const pincode = (req.body || {}).pincode;
  if (!/^\d{6}$/.test(String(pincode || ''))) return res.status(400).json({ error: 'pincode must be a six-digit number' });
  const db = load();
  const result = await connectors.pincode.lookup(db, pincode);
  save(db);
  if (!result.valid) return res.status(400).json(result);
  res.json(result);
});

// API Setu Gateway (Govt of India Mock / Static Adapter)
router.post('/apisetu/fetch-certificate', requireAuth, (req, res) => {
  const { docType, aadhaar } = req.body || {};
  if (!docType) return res.status(400).json({ error: 'docType is required (e.g. IncomeCertificate, CasteCertificate)' });
  const db = load();
  const result = connectors.apiSetuMock.fetchCertificate(db, docType, aadhaar || '1234-5678-9012');
  save(db);
  res.json(result);
});

router.get('/health', requireAuth, requireRole('admin'), (req, res) => {
  const db = load();
  const recent = db.connectorLogs.slice(-50).reverse().map(log => ({
    ...log,
    request: maskSensitiveData(log.request),
    response: maskSensitiveData(log.response)
  }));
  const byConnector = {};
  for (const log of db.connectorLogs) {
    byConnector[log.connector] = byConnector[log.connector] || { total: 0, success: 0, error: 0 };
    byConnector[log.connector].total++;
    byConnector[log.connector][log.status] = (byConnector[log.connector][log.status] || 0) + 1;
  }
  res.json({ byConnector, recent });
});

module.exports = router;
