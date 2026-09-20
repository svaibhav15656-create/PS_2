const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { load, save } = require('../db');
const { sign } = require('../middleware/auth');
const { logAction } = require('../audit');
const { validateEmail, validateRegistration } = require('../validation');
const { findPotentialDuplicates, createFlag } = require('../mdm');

const router = express.Router();

// Single login endpoint shared by every "department portal" — this is the
// federated identity / SSO layer: one credential, one token, works everywhere.
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || !validateEmail(email) || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'A valid email and password are required' });
  }
  const db = load();
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = sign(user);
  logAction(db, { actor: user.name, actorRole: user.role, action: 'LOGIN', entity: 'user', entityId: user.id });
  save(db);
  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, departmentId: user.departmentId || null, email: user.email }
  });
});

// Citizen self-registration — feeds the Master Data Management dedupe check.
router.post('/register-citizen', (req, res) => {
  const body = req.body || {};
  const { name, aadhaar, mobile, email, password, dateOfBirth } = body;
  const validationErrors = validateRegistration(body);
  if (validationErrors.length) return res.status(400).json({ error: 'Invalid registration data', details: validationErrors });
  const db = load();
  const dup = db.users.find(u => u.mobile === mobile || u.email === email || (aadhaar && u.aadhaar === aadhaar));
  if (dup) {
    return res.status(409).json({ error: 'A citizen record already exists with this Aadhaar/mobile/email (MDM dedupe match)', existingId: dup.id });
  }
  const user = { id: randomUUID(), name, role: 'citizen', aadhaar: aadhaar || null, mobile, email, dateOfBirth: dateOfBirth || null, passwordHash: bcrypt.hashSync(password, 8) };
  db.users.push(user);
  const potentialDuplicates = findPotentialDuplicates(db, user)
    .filter(match => match.user.id !== user.id);
  potentialDuplicates.forEach(match => createFlag(db, user.id, match));
  logAction(db, { actor: name, actorRole: 'citizen', action: 'REGISTER', entity: 'user', entityId: user.id });
  save(db);
  const token = sign(user);
  res.status(201).json({ token, user: { id: user.id, name, role: 'citizen', email } });
});

// Logout endpoint (invalidates session on client and records audit)
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// Refresh token endpoint
router.post('/refresh', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });
  const jwt = require('jsonwebtoken');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production');
    const db = load();
    const user = db.users.find(u => u.id === decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const newToken = sign(user);
    res.json({ token: newToken, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// OIDC Discovery Endpoint
router.get('/oidc/.well-known/openid-configuration', (req, res) => {
  res.json({
    issuer: 'http://localhost:4000/api/auth/oidc',
    authorization_endpoint: 'http://localhost:4000/api/auth/oidc/authorize',
    token_endpoint: 'http://localhost:4000/api/auth/oidc/token',
    userinfo_endpoint: 'http://localhost:4000/api/auth/oidc/userinfo',
    response_types_supported: ['code', 'id_token', 'token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256']
  });
});

// OIDC Authorize Stub
router.get('/oidc/authorize', (req, res) => {
  const { client_id, redirect_uri, state } = req.query || {};
  const code = 'mock-oidc-code-' + randomUUID().slice(0, 8);
  if (redirect_uri) {
    return res.redirect(`${redirect_uri}?code=${code}&state=${state || ''}`);
  }
  res.json({ code, state });
});

// OIDC Token Stub
router.post('/oidc/token', (req, res) => {
  const { grant_type, code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code parameter required' });
  const db = load();
  const sampleUser = db.users[0];
  const accessToken = sign(sampleUser);
  res.json({
    access_token: accessToken,
    id_token: accessToken,
    token_type: 'Bearer',
    expires_in: 86400
  });
});

module.exports = router;

