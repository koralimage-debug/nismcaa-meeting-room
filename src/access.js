'use strict';
/** Who may see what. These helpers are used by every route (checks happen on the server). */
const { COUNTRIES } = require('./config');

const isAdmin = (u) => !!u && u.role === 'admin';

const isGuest = (u) => !!u && u.role === 'guest';
/** An approved sponsor or vendor (may open the Guest Meeting Room). */
const hasGuestAccess = (u) => isGuest(u) && u.status === 'guest_approved';

/** VALID | EXPIRED | ENDED | null (no ID yet) */
function idState(u, nowMs = Date.now()) {
  if (!u || !u.volunteer_id) return null;
  if (u.id_status === 'ended') return 'ENDED';
  if (u.id_expires_at && Date.parse(u.id_expires_at) < nowMs) return 'EXPIRED';
  return 'VALID';
}

/** Meeting Room access: admins, or approved volunteers whose ID is valid. */
function hasRoomAccess(u) {
  if (!u) return false;
  if (isAdmin(u)) return true;
  return u.status === 'approved' && idState(u) === 'VALID' && COUNTRIES.includes(u.country);
}

function statusLabel(u) {
  if (isAdmin(u)) return 'Administrator';
  if (isGuest(u)) return ({ guest_pending: 'Waiting for approval', guest_approved: 'Approved guest', guest_rejected: 'Not approved at this time', guest_suspended: 'Suspended' })[u.status] || u.status;
  switch (u.status) {
    case 'applicant': return 'Applicant (final test not passed yet)';
    case 'interest': return 'Interest only (your country is not listed yet)';
    case 'waiting': return 'Waiting for approval';
    case 'approved': {
      const s = idState(u);
      return s === 'VALID' ? 'Approved volunteer' : s === 'EXPIRED' ? 'ID expired (renewal needed)' : 'ID ended';
    }
    case 'declined': return 'Not approved at this time';
    case 'ended': return 'ID ended';
    default: return u.status;
  }
}

/** Countries a person may open in the plan/chat: admins any, volunteers only their own. */
function allowedCountries(u) {
  if (isAdmin(u)) return COUNTRIES.slice();
  return u && u.country ? [u.country] : [];
}

module.exports = { isGuest, hasGuestAccess, isAdmin, idState, hasRoomAccess, statusLabel, allowedCountries };
