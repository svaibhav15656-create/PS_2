// server.js — the API Gateway / middleware layer described in the problem
// statement: one entry point that fronts every department's services,
// enforces auth + RBAC, and logs everything for audit.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const citizenRoutes = require('./routes/citizens');
const consentRoutes = require('./routes/consent');
const applicationRoutes = require('./routes/applications');
const connectorRoutes = require('./routes/connectorRoutes');
const auditRoutes = require('./routes/audit');
const dashboardRoutes = require('./routes/dashboard');
const grievanceRoutes = require('./routes/grievances');
const adminRoutes = require('./routes/admin');
const assistantRoutes = require('./routes/assistant');
const { load, save } = require('./db');
const { checkSlaBreaches } = require('./escalation');

// Auto-seed demo data on first boot so the prototype works out of the box.
try { require('./seed'); } catch (e) { console.error('Seed error:', e.message); }

const app = express();
const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production');
}

app.use(cors({ origin: (origin, cb) => cb(null, true), credentials: true }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'https://api.postalpincode.in'],
      imgSrc: ["'self'", 'data:'],
    }
  }
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.json());

// Request log
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/api/docs', (req, res) => {
  const fs = require('fs');
  const specPath = path.join(__dirname, 'openapi.yaml');
  if (fs.existsSync(specPath)) {
    res.setHeader('Content-Type', 'text/yaml');
    return res.send(fs.readFileSync(specPath, 'utf8'));
  }
  res.status(404).json({ error: 'OpenAPI specification file not found' });
});

app.get('/api/departments', (req, res) => {
  const db = load();
  res.json(db.departments);
});

app.use('/api/auth', authRoutes);
app.use('/api/citizens', citizenRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/connectors', connectorRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/grievances', grievanceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/assistant', assistantRoutes);

const escalationIntervalMs = Number(process.env.SLA_CHECK_INTERVAL_MS || 5 * 60 * 1000);
setInterval(() => {
  const db = load();
  if (checkSlaBreaches(db)) save(db);
}, escalationIntervalMs).unref();

app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must contain valid JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nGov Interoperability Platform API running on http://localhost:${PORT}`);
    console.log(`Frontend served at            http://localhost:${PORT}/index.html\n`);
  });
}

module.exports = app;
