// connectors.js — Reusable connector layer. Each connector wraps a
// (simulated) legacy or third-party system behind one consistent interface
// (verify/fetch), so the rest of the platform never has to know whether the
// underlying system is a modern REST API, a SOAP service or an old FTP dump.
// Swap the mock logic here for a real client without touching any route.
const { randomUUID } = require('crypto');

function logCall(db, connector, request, response, status) {
  db.connectorLogs.push({ id: randomUUID(), connector, request, response, status, timestamp: new Date().toISOString() });
}

function call(db, connector, request, operation, fallback) {
  try {
    const response = operation();
    logCall(db, connector, request, response, 'success');
    return response;
  } catch (error) {
    logCall(db, connector, request, { error: error.message }, 'error');
    return fallback;
  }
}

async function asyncCall(db, connector, request, operation, fallback) {
  try {
    const response = await operation();
    logCall(db, connector, request, response, response?.valid === false ? 'error' : 'success');
    return response;
  } catch (error) {
    logCall(db, connector, request, { error: error.message }, 'error');
    return fallback;
  }
}

const connectors = {
  // Simulated UIDAI-style Aadhaar e-KYC verification
  aadhaar: {
    name: 'Aadhaar e-KYC (mock)',
    verify(db, aadhaar) {
      return call(db, 'aadhaar', { aadhaar }, () => {
        const ok = /^\d{4}-\d{4}-\d{4}$/.test(aadhaar);
        return ok ? { verified: true, nameMatch: true, ageAbove18: true } : { verified: false, reason: 'Invalid Aadhaar format' };
      }, { verified: false, reason: 'Connector failure; manual verification required' });
    }
  },
  // PAN holder type codes: P individual, C company, H HUF, F firm/LLP,
  // A association, T trust, B body of individuals, L local authority,
  // J artificial juridical person, G government.
  pan: {
    name: 'PAN Structural Validation (local)',
    verify(db, pan) {
      return call(db, 'pan', { pan }, () => {
        const normalized = String(pan || '').toUpperCase();
        if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(normalized)) return { verified: false, reason: 'PAN must contain five letters, four digits, and a final letter' };
        const holderTypes = { P: 'individual', C: 'company', H: 'HUF', F: 'firm or LLP', A: 'association of persons', T: 'trust', B: 'body of individuals', L: 'local authority', J: 'artificial juridical person', G: 'government' };
        const holderType = holderTypes[normalized[3]];
        if (!holderType) return { verified: false, reason: 'PAN contains an unknown holder type code' };
        return { verified: true, structuralOnly: true, holderTypeCode: normalized[3], holderType };
      }, { verified: false, reason: 'Connector failure; manual verification required' });
    }
  },
  // Simulated legacy Ration Card DB lookup (e.g. FTP/CSV based legacy system)
  rationDb: {
    name: 'Legacy Ration Card Registry (mock)',
    lookup(db, mobile) {
      return call(db, 'rationDb', { mobile }, () => ({ found: false, note: 'No existing ration card linked to this mobile number' }), { found: false, note: 'Connector failure; manual verification required' });
    }
  },
  // Simulated income-record registry used to auto-validate income certificates
  incomeRegistry: {
    name: 'State Income Registry (mock)',
    fetch(db, aadhaar) {
      return call(db, 'incomeRegistry', { aadhaar }, () => ({ annualIncome: 185000, source: 'Tehsil Revenue Records', asOf: '2026-03-31' }), { manualVerificationRequired: true });
    }
  },
  casteRegistry: {
    name: 'State Caste Certificate Registry (mock)',
    lookup(db, aadhaar, casteCategory) {
      return call(db, 'casteRegistry', { aadhaar, casteCategory }, () => ({ verified: Boolean(casteCategory), source: 'State Caste Certificate Registry' }), { verified: false, manualVerificationRequired: true });
    }
  },
  pincode: {
    name: 'India Post Pincode Lookup (real, free API)',
    async lookup(db, pincode) {
      const normalized = String(pincode || '').trim();
      if (!/^\d{6}$/.test(normalized)) return asyncCall(db, 'pincode', { pincode: normalized }, async () => ({ valid: false, reason: 'Pincode must be a six-digit number' }), { valid: false, reason: 'Pincode must be a six-digit number' });
      return asyncCall(db, 'pincode', { pincode: normalized }, async () => {
        const response = await fetch(`https://api.postalpincode.in/pincode/${normalized}`);
        if (!response.ok) throw new Error(`India Post API returned HTTP ${response.status}`);
        const data = await response.json();
        const record = data?.[0];
        if (record?.Status !== 'Success' || !record.PostOffice?.[0]) return { valid: false, reason: 'Pincode not found' };
        return { valid: true, district: record.PostOffice[0].District, state: record.PostOffice[0].State };
      }, { valid: false, reason: 'Pincode lookup unavailable; try again or use manual verification' });
    }
  },
  sdeRegistry: {
    name: 'Skill Development & Employment Registry (mock)',
    lookup(db, aadhaar) {
      return call(db, 'sdeRegistry', { aadhaar }, () => ({
        enrolled: true,
        trade: 'Solar Technician & Electricals',
        status: 'Certified & Employed',
        certifiedDate: '2025-11-15'
      }), { enrolled: false, manualVerificationRequired: true });
    }
  },
  apiSetuMock: {
    name: 'API Setu Gateway (Govt of India - Mock/Static)',
    fetchCertificate(db, docType, aadhaar) {
      return call(db, 'apiSetuMock', { docType, aadhaar }, () => ({
        gateway: 'API Setu / MeitY National Open API Platform',
        certificateType: docType,
        status: 'ISSUED_AND_DIGITALLY_SIGNED',
        issuer: 'Govt of Maharashtra Departmental Repository',
        digitalSignatureVerified: true,
        issuedAt: '2025-08-10T10:00:00Z',
        data: docType === 'IncomeCertificate'
          ? { annualIncome: 185000, validUntil: '2026-03-31' }
          : { casteCategory: 'OBC', certificateNo: 'MH-SWD-2025-8841' }
      }), { status: 'SERVICE_UNAVAILABLE', manualVerificationRequired: true });
    }
  }
};

function maskSensitiveData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);
  const sensitiveKeys = ['password', 'secret', 'token', 'key', 'authorization', 'aadhaar', 'pan', 'uri', 'url'];
  const masked = {};
  for (const [k, v] of Object.entries(obj)) {
    const isSensitive = sensitiveKeys.some(sk => k.toLowerCase().includes(sk));
    if (isSensitive && typeof v === 'string') {
      if (k.toLowerCase().includes('aadhaar') && v.length >= 4) {
        masked[k] = `XXXX-XXXX-${v.slice(-4)}`;
      } else {
        masked[k] = '***MASKED***';
      }
    } else if (typeof v === 'object' && v !== null) {
      masked[k] = maskSensitiveData(v);
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

module.exports = { connectors, maskSensitiveData };

