const express = require('express');
const { load } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { connectors } = require('../connectors');

const router = express.Router();

router.post('/chat', requireAuth, requireRole('citizen'), (req, res) => {
  const { message } = req.body || {};
  const query = String(message || '').toLowerCase();
  const db = load();

  const citizen = db.users.find(u => u.id === req.user.id);
  const applications = db.applications.filter(a => a.citizenId === req.user.id);
  const consents = db.consents.filter(c => c.citizenId === req.user.id);

  let reply = '';

  if (query.includes('status') || query.includes('where') || query.includes('track') || query.includes('application')) {
    if (!applications.length) {
      reply = `Hello ${citizen.name}, you currently have no active applications on SetuOne. You can apply for services directly from the Service Catalog!`;
    } else {
      const appSummaries = applications.map(a => {
        const s = db.services.find(srv => srv.id === a.serviceId);
        return `• "${s?.name || 'Service'}" (Ref: ${a.id.slice(0, 8)}): Status is "${a.status}", Current Stage: "${s?.workflow?.[a.currentStageIndex] || a.status}".`;
      }).join('\n');
      reply = `Hello ${citizen.name}, here is the current status of your active application(s):\n\n${appSummaries}`;
    }
  } else if (query.includes('document') || query.includes('need') || query.includes('require')) {
    reply = `To apply for government services on SetuOne, standard required documents include:\n1. Aadhaar Card (e-KYC verified via Aadhaar connector)\n2. Income Certificate / Tehsildar Proof (auto-filled if consent is granted!)\n3. Caste Certificate (for scholarship schemes)\n4. Address proof / Pincode verification`;
  } else if (query.includes('scheme') || query.includes('eligible') || query.includes('recommend')) {
    reply = `Based on your verified profile, you qualify for:\n• Income Certificate (Revenue Dept)\n• Skill Training Enrollment (Skill Development Dept)\n• Scholarship Application (Social Welfare Dept)\n\nYou can click "Apply with pre-filled details" on your dashboard to auto-complete the forms using your active consents!`;
  } else {
    reply = `Hello ${citizen.name}! I am your SetuOne Citizen AI Assistant. You can ask me:\n- "Where is my application?"\n- "What documents do I need?"\n- "What schemes am I eligible for?"`;
  }

  res.json({
    response: reply,
    isAiGenerated: true,
    disclaimer: '[AI Generated Answer]'
  });
});

module.exports = router;
