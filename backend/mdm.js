const { randomUUID } = require('crypto');

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function mobileSuffix(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    for (let index = 0; index <= right.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length];
}

function similarName(left, right) {
  if (!left || !right) return false;
  const distance = levenshtein(left, right);
  return distance <= Math.max(1, Math.floor(Math.max(left.length, right.length) * 0.2));
}

function findPotentialDuplicates(db, candidate) {
  const candidateName = normalizeName(candidate.name);
  const candidateSuffix = mobileSuffix(candidate.mobile);
  return db.users
    .filter(user => user.role === 'citizen')
    .map(user => {
      const existingName = normalizeName(user.name);
      const sameNameAndMobileSuffix = candidateName && candidateName === existingName
        && candidateSuffix && candidateSuffix === mobileSuffix(user.mobile);
      const sameDobAndSimilarName = candidate.dateOfBirth && user.dateOfBirth === candidate.dateOfBirth
        && similarName(candidateName, existingName);
      if (sameNameAndMobileSuffix) return { user, reason: 'Same normalized name and mobile last four digits' };
      if (sameDobAndSimilarName) return { user, reason: 'Same date of birth and similar name' };
      return null;
    })
    .filter(Boolean);
}

function createFlag(db, candidateId, match) {
  const candidateIds = [match.user.id, candidateId].sort();
  const existing = db.dataQualityFlags.find(flag => flag.status === 'open'
    && flag.type === 'POTENTIAL_DUPLICATE'
    && flag.candidateIds.length === candidateIds.length
    && flag.candidateIds.every(id => candidateIds.includes(id)));
  if (existing) return existing;
  const flag = {
    id: randomUUID(),
    type: 'POTENTIAL_DUPLICATE',
    candidateIds,
    reason: match.reason,
    status: 'open',
    createdAt: new Date().toISOString()
  };
  db.dataQualityFlags.push(flag);
  return flag;
}

function mergeDuplicateCitizens(db, primaryId, duplicateId) {
  const primary = db.users.find(u => u.id === primaryId && u.role === 'citizen');
  const duplicate = db.users.find(u => u.id === duplicateId && u.role === 'citizen');
  if (!primary || !duplicate) return { error: 'Primary or duplicate citizen record not found' };

  for (const app of db.applications) {
    if (app.citizenId === duplicateId) app.citizenId = primaryId;
  }
  for (const consent of db.consents) {
    if (consent.citizenId === duplicateId) consent.citizenId = primaryId;
  }
  for (const notif of db.notifications) {
    if (notif.citizenId === duplicateId) notif.citizenId = primaryId;
  }

  duplicate.status = 'merged';
  duplicate.mergedInto = primaryId;

  const resolvedFlags = [];
  for (const flag of db.dataQualityFlags) {
    if (flag.status === 'open' && flag.candidateIds.includes(duplicateId)) {
      flag.status = 'resolved';
      flag.resolvedAt = new Date().toISOString();
      flag.resolution = `Merged duplicate citizen ${duplicateId} into ${primaryId}`;
      resolvedFlags.push(flag.id);
    }
  }

  return { success: true, primaryId, duplicateId, resolvedFlags };
}

module.exports = { findPotentialDuplicates, createFlag, mergeDuplicateCitizens };