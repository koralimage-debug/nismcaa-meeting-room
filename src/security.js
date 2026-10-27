'use strict';
/**
 * Security building blocks: password hashing (scrypt), sessions stored in SQLite,
 * CSRF tokens, login lockout and simple in-memory rate limits.
 * No third-party auth service and no e-mail are used anywhere.
 */
const crypto = require('crypto');
const { promisify } = require('util');
const { now, sha256 } = require('./db');

const scrypt = promisify(crypto.scrypt);

// ---------- passwords ----------
async function hashPassword(password, config) {
  const N = config.scryptN || 16384, r = 8, p = 1;
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [alg, N, r, p, saltB, keyB] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const key = Buffer.from(keyB, 'base64');
  const got = await scrypt(password, Buffer.from(saltB, 'base64'), key.length, { N: +N, r: +r, p: +p, maxmem: 128 * +N * +r * 2 });
  return crypto.timingSafeEqual(got, key);
}
const PASSWORD_MIN = 10;
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (pw.length > 200) return 'Password is too long.';
  return null;
}
function randomPassword() {
  // readable temporary password, shown once on screen to an admin
  const words = crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, 'x');
  return 'Tmp-' + words.slice(0, 10) + '-' + crypto.randomInt(10, 99);
}

// ---------- cookies ----------
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// ---------- sessions ----------
const COOKIE = 'nm_sid';
function makeSessions(db, config) {
  const maxAge = Math.floor(config.sessionIdleMs / 1000);
  const setCookie = (res, token) => {
    res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.production ? '; Secure' : ''}`);
  };
  function create(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(id_hash,user_id,csrf,created_at,last_seen) VALUES (?,?,?,?,?)')
      .run(sha256(token), userId || null, crypto.randomBytes(24).toString('hex'), now(), now());
    setCookie(res, token);
    return sha256(token);
  }
  /** Middleware: attach req.session, req.user, res.locals.csrf; drop sessions idle for more than 3 days. */
  function load(req, res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    let row = null;
    if (token) {
      row = db.prepare('SELECT * FROM sessions WHERE id_hash=?').get(sha256(token));
      if (row && Date.now() - Date.parse(row.last_seen) > config.sessionIdleMs) {
        db.prepare('DELETE FROM sessions WHERE id_hash=?').run(row.id_hash);
        row = null;
      }
    }
    if (!row) { const h = create(res, null); row = db.prepare('SELECT * FROM sessions WHERE id_hash=?').get(h); }
    else if (Date.now() - Date.parse(row.last_seen) > 60000) {
      db.prepare('UPDATE sessions SET last_seen=? WHERE id_hash=?').run(now(), row.id_hash);
      setCookie(res, token); // slide the cookie too
    }
    req.session = row;
    req.user = row.user_id ? db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id) : null;
    res.locals.csrf = row.csrf;
    res.locals.flash = null;
    if (row.flash) {
      try { res.locals.flash = JSON.parse(row.flash); } catch (e) { /* ignore */ }
      db.prepare('UPDATE sessions SET flash=NULL WHERE id_hash=?').run(row.id_hash);
    }
    req.flash = (type, msg) => db.prepare('UPDATE sessions SET flash=? WHERE id_hash=?').run(JSON.stringify({ type, msg }), row.id_hash);
    next();
  }
  /** Sign in: replace the session id (prevents session fixation). */
  function login(req, res, userId) {
    db.prepare('DELETE FROM sessions WHERE id_hash=?').run(req.session.id_hash);
    return create(res, userId);
  }
  function logout(req, res) {
    db.prepare('DELETE FROM sessions WHERE id_hash=?').run(req.session.id_hash);
    create(res, null);
  }
  function endAllForUser(userId) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }
  return { load, login, logout, create, endAllForUser };
}

// ---------- CSRF ----------
function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/form-data')) return next(); // route calls csrfAfterMultipart
  return csrfVerify(req, res, next);
}
function csrfVerify(req, res, next) {
  const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || '';
  const want = req.session.csrf;
  const a = Buffer.from(String(sent)); const b = Buffer.from(String(want));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).render('error', { title: 'Request blocked', message: 'Your form expired or was not valid. Go back, reload the page and try again.' });
  next();
}

// ---------- rate limits ----------
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return {
    hit(key) {
      const t = Date.now();
      const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
      arr.push(t); hits.set(key, arr);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
      return arr.length > max;
    },
    middleware() {
      return (req, res, next) => (this.hit(req.ip || 'x')
        ? res.status(429).render('error', { title: 'Slow down', message: 'Too many requests. Please wait a minute and try again.' }) : next());
    },
    reset() { hits.clear(); },
  };
}

// ---------- login lockout (per e-mail, stored in the database) ----------
function makeLockout(db, config) {
  const windowMs = config.lockMinutes * 60000;
  return {
    check(key) {
      const r = db.prepare('SELECT * FROM login_failures WHERE k=?').get(key);
      if (r && r.locked_until && Date.parse(r.locked_until) > Date.now()) return Math.ceil((Date.parse(r.locked_until) - Date.now()) / 60000);
      return 0;
    },
    fail(key) {
      const r = db.prepare('SELECT * FROM login_failures WHERE k=?').get(key);
      let count = 1; let first = now();
      if (r && Date.now() - Date.parse(r.first_at) < windowMs) { count = r.count + 1; first = r.first_at; }
      const locked = count >= config.lockAfter ? new Date(Date.now() + windowMs).toISOString() : null;
      db.prepare('INSERT INTO login_failures(k,count,first_at,locked_until) VALUES (?,?,?,?) ON CONFLICT(k) DO UPDATE SET count=excluded.count, first_at=excluded.first_at, locked_until=excluded.locked_until')
        .run(key, count, first, locked);
      return !!locked;
    },
    clear(key) { db.prepare('DELETE FROM login_failures WHERE k=?').run(key); },
  };
}

module.exports = { hashPassword, verifyPassword, passwordProblem, randomPassword, makeSessions, csrfCheck, csrfVerify, makeLimiter, makeLockout, PASSWORD_MIN };
