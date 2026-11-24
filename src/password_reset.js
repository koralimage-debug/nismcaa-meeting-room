'use strict';
/** One-time password-reset tokens. The raw token is shown only in the e-mail;
 *  the database stores a hash. Tokens expire after 60 minutes and work once.
 */
const crypto = require('crypto');
const { now, sha256 } = require('./db');

const TOKEN_BYTES = 32;
const TTL_MS = 60 * 60 * 1000;
const SENT_MSG = 'If an account exists for that e-mail, we have sent a reset link. Please check your inbox and your spam folder. The link expires in 60 minutes and can be used only once.';
const INVALID_MSG = 'Request a new link when you are ready to choose a new password.';

function createToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function hashToken(token) {
  return sha256(String(token || ''));
}

function looksLikeToken(token) {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
}

/** Invalidate earlier unused tokens for this person, then store a new hashed token. Returns the raw token. */
function issue(db, userId, ip) {
  const token = createToken();
  const at = now();
  const expires = new Date(Date.now() + TTL_MS).toISOString();
  db.transaction(() => {
    db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(at, userId);
    db.prepare('INSERT INTO password_resets(user_id,token_hash,created_at,expires_at,requested_ip) VALUES (?,?,?,?,?)')
      .run(userId, hashToken(token), at, expires, String(ip || '').slice(0, 80));
  })();
  return { token, expiresAt: expires };
}

/** A still-valid, unused, unexpired token, or null. Never throws. */
function findValid(db, token) {
  if (!looksLikeToken(token)) return null;
  const row = db.prepare(
    'SELECT r.id, r.user_id, r.expires_at, r.used_at, u.email, u.name, u.pw_hash FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=?'
  ).get(hashToken(token));
  if (!row || row.used_at) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return row;
}

function markUsedForUser(db, userId) {
  db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now(), userId);
}

/** An account that can receive a reset: any role, with a password already set. */
function resettableUser(db, email) {
  const u = db.prepare('SELECT id, email, name, role, pw_hash FROM users WHERE email=?').get(email);
  if (!u || !u.pw_hash) return null;
  return u;
}

module.exports = {
  TOKEN_BYTES, TTL_MS, SENT_MSG, INVALID_MSG,
  createToken, hashToken, looksLikeToken, issue, findValid, markUsedForUser, resettableUser,
};
