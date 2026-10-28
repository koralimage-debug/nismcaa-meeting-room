'use strict';
/** Home, sign-up, sign-in, sign-out, admin claim, password change, private photos, public ID check. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { now, audit, sha256 } = require('../db');
const { COUNTRIES, NOT_LISTED } = require('../config');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 20 } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(n) ? n : null);

module.exports = function (app, ctx) {
  const { db, sessions, lockout, config, sec, access } = ctx;
  const { csrfVerify } = sec;

  const home = (user) => (user ? '/meeting-room' : '/sign-in');

  app.get('/', (req, res) => res.render('home', { title: 'Welcome' }));

  // ---------------- sign up ----------------
  app.get('/sign-up', (req, res) => {
    if (req.user) return res.redirect('/meeting-room');
    res.render('sign-up', { title: 'Sign up', errors: [], v: {} });
  });

  function runUpload(req, res, next) {
    upload.single('photo')(req, res, (err) => {
      if (!err) return next();
      req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'The photo is larger than 2 MB. Please choose a smaller JPG or PNG.' : 'The photo could not be uploaded.';
      next();
    });
  }

  app.post('/sign-up', ctx.limiters.signup.middleware(), runUpload, csrfVerify, async (req, res) => {
    if (req.user) return res.redirect('/meeting-room');
    const b = req.body || {};
    const v = { name: (b.name || '').trim(), email: (b.email || '').trim().toLowerCase(), phone: (b.phone || '').trim(), country: b.country || '' };
    const errors = [];
    if (req.uploadError) errors.push(req.uploadError);
    if (v.name.length < 2 || v.name.length > 100) errors.push('Please enter your full name.');
    if (!EMAIL_RE.test(v.email) || v.email.length > 200) errors.push('Please enter a valid e-mail address. It will be your sign-in ID.');
    const pwProblem = sec.passwordProblem(b.password);
    if (pwProblem) errors.push(pwProblem);
    else if (b.password !== b.password2) errors.push('The two passwords do not match.');
    if (!/^[+\d][\d\s().-]{6,24}$/.test(v.phone)) errors.push('Please enter a phone number (digits, spaces, + ( ) - only).');
    if (![...COUNTRIES, NOT_LISTED].includes(v.country)) errors.push('Please choose the country where you live.');
    if (b.age18 !== 'yes') errors.push('You must confirm that you are 18 or older.');
    let photoBuf = null;
    if (!req.uploadError) {
      const f = req.file;
      if (!f) errors.push('Please upload a clear photo (JPG or PNG, up to 2 MB). It is used for your ID card.');
      else {
        const isJpg = f.buffer[0] === 0xff && f.buffer[1] === 0xd8 && f.buffer[2] === 0xff;
        const isPng = f.buffer.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        if (!isJpg && !isPng) errors.push('The photo must be a JPG or PNG file.');
        else photoBuf = f.buffer;
      }
    }
    if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email=?').get(v.email)) errors.push('An account with this e-mail already exists. Please sign in instead.');
    if (!errors.length) {
      try {
        // Re-encode: strips hidden metadata (GPS etc.) and makes a square ID-card photo.
        const out = await sharp(photoBuf).rotate().resize(600, 600, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();
        const file = crypto.randomBytes(16).toString('hex') + '.jpg';
        fs.writeFileSync(path.join(config.dataDir, 'photos', file), out, { mode: 0o600 });
        const listed = COUNTRIES.includes(v.country);
        const hash = await sec.hashPassword(b.password, config);
        const r = db.prepare(`INSERT INTO users(email,name,phone,pw_hash,role,status,country_chosen,photo_file,age_confirmed,created_at)
          VALUES (?,?,?,?, 'volunteer', ?, ?, ?, 1, ?)`).run(v.email, v.name, v.phone, hash, listed ? 'applicant' : 'interest', v.country, file, now());
        audit(db, 'signup', r.lastInsertRowid, v.email, 'country chosen: ' + v.country);
        sessions.login(req, res, r.lastInsertRowid);
        // flash needs the NEW session row
        const nuser = r.lastInsertRowid;
        db.prepare('UPDATE sessions SET flash=? WHERE user_id=?').run(JSON.stringify({ type: 'ok', msg: 'Your account is ready. Next: read the course and take the final test.' }), nuser);
        return res.redirect('/meeting-room');
      } catch (e) {
        errors.push('We could not read that image. Please try another JPG or PNG.');
        if (!config.quiet) console.error(e);
      }
    }
    delete v.password;
    res.status(400).render('sign-up', { title: 'Sign up', errors, v });
  });

  // ---------------- sign in ----------------
  app.get('/sign-in', (req, res) => {
    if (req.user) return res.redirect('/meeting-room');
    res.render('sign-in', { title: 'Sign in', error: null, email: '', next: safeNext(req.query.next) || '', guest: false });
  });

  app.post('/sign-in', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
    const next = safeNext(req.body.next) || '';
    const guest = req.body.guest === '1';
    const fail = (msg, code = 401) => res.status(code).render('sign-in', { title: 'Sign in', error: msg, email, next, guest });
    if (ctx.limiters.login.hit(req.ip || 'x')) return fail('Too many attempts from this device. Please wait 15 minutes.', 429);
    const mins = lockout.check(email);
    if (mins) return fail(`Too many wrong tries. This account is locked for about ${mins} more minute(s).`, 429);
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    // always run a hash comparison so timing does not reveal whether the e-mail exists
    const ok = await sec.verifyPassword(String(req.body.password || ''), u ? u.pw_hash : DUMMY_HASH(config));
    if (!u || !u.pw_hash || !ok) {
      const locked = lockout.fail(email);
      if (locked) audit(db, 'lockout', u ? u.id : null, email, 'locked after repeated failures');
      return fail(locked ? 'Too many wrong tries. This account is locked for 15 minutes.' : 'E-mail or password is not correct.');
    }
    lockout.clear(email);
    sessions.login(req, res, u.id);
    if (u.must_change_pw) return res.redirect('/account/password');
    // Sponsors and vendors land in the Guest Meeting Room; everyone else is unchanged.
    if (u.role === 'guest') return res.redirect(next.startsWith('/guest') || next === '/account/password' ? next : '/guest');
    res.redirect(next && !next.startsWith('/guest') ? next : '/meeting-room');
  });

  app.post('/sign-out', (req, res) => { sessions.logout(req, res); res.redirect('/'); });

  // ---------------- one-time admin claim ----------------
  const claimOpen = () => db.prepare('SELECT COUNT(*) c FROM claim_codes WHERE used_at IS NULL').get().c > 0;
  app.get('/admin/claim', (req, res) => {
    if (!claimOpen()) return res.status(404).render('error', { title: 'Not available', message: 'Admin set-up is finished. This page is switched off.' });
    res.render('claim', { title: 'Admin set-up', error: null });
  });
  app.post('/admin/claim', async (req, res) => {
    if (!claimOpen()) return res.status(404).render('error', { title: 'Not available', message: 'Admin set-up is finished. This page is switched off.' });
    const bad = (m) => res.status(400).render('claim', { title: 'Admin set-up', error: m });
    if (ctx.limiters.claim.hit(req.ip || 'x')) return bad('Too many tries. Please wait 15 minutes.');
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim().toUpperCase();
    const row = db.prepare(`SELECT c.*, u.id uid FROM claim_codes c JOIN users u ON u.id=c.user_id WHERE u.email=? AND u.role='admin' AND c.used_at IS NULL`).get(email);
    const given = Buffer.from(sha256(code)); const want = Buffer.from(row ? row.code_hash : sha256('x'));
    if (!row || !crypto.timingSafeEqual(given, want)) return bad('That e-mail and claim code do not match.');
    const pw = sec.passwordProblem(req.body.password);
    if (pw) return bad(pw);
    if (req.body.password !== req.body.password2) return bad('The two passwords do not match.');
    db.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(await sec.hashPassword(req.body.password, config), row.uid);
    db.prepare('UPDATE claim_codes SET used_at=? WHERE user_id=?').run(now(), row.uid);
    audit(db, 'admin_claim', row.uid, email, 'admin account claimed');
    // keep the claim-code file tidy: remove claimed e-mails, delete when empty
    const f = path.join(config.dataDir, 'ADMIN_CLAIM_CODES.txt');
    try {
      if (!claimOpen()) fs.rmSync(f, { force: true });
      else fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.startsWith(email + ':')).join('\n'), { mode: 0o600 });
    } catch (e) { /* ignore */ }
    sessions.login(req, res, row.uid);
    res.redirect('/admin');
  });

  // ---------------- change password ----------------
  app.get('/account/password', (req, res) => {
    if (!req.user) return res.redirect('/sign-in');
    res.render('password', { title: 'Change password', error: null });
  });
  app.post('/account/password', async (req, res) => {
    if (!req.user) return res.redirect('/sign-in');
    const bad = (m) => res.status(400).render('password', { title: 'Change password', error: m });
    if (!(await sec.verifyPassword(String(req.body.current || ''), req.user.pw_hash))) return bad('Your current password is not correct.');
    const p = sec.passwordProblem(req.body.password);
    if (p) return bad(p);
    if (req.body.password !== req.body.password2) return bad('The two new passwords do not match.');
    db.prepare('UPDATE users SET pw_hash=?, must_change_pw=0 WHERE id=?').run(await sec.hashPassword(req.body.password, config), req.user.id);
    audit(db, 'password_change', req.user.id, req.user.email, 'own password changed');
    req.flash('ok', 'Your password was changed.');
    res.redirect('/meeting-room');
  });

  // ---------------- private photos (owner or admin only) ----------------
  app.get('/photos/:id', (req, res) => {
    if (!req.user) return res.status(404).render('error', { title: 'Page not found', message: 'We could not find that page.' });
    const id = Number(req.params.id);
    const u = db.prepare('SELECT id, photo_file FROM users WHERE id=?').get(id);
    if (!u || !u.photo_file || !(access.isAdmin(req.user) || req.user.id === u.id)) return res.status(404).render('error', { title: 'Page not found', message: 'We could not find that page.' });
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/jpeg' });
    res.sendFile(path.join(config.dataDir, 'photos', path.basename(u.photo_file)));
  });

  // ---------------- public ID check ----------------
  app.get('/verify/:vid', ctx.limiters.verify.middleware(), (req, res) => {
    const vid = String(req.params.vid || '').toUpperCase();
    const u = db.prepare('SELECT name, country, volunteer_id, id_expires_at, id_status FROM users WHERE volunteer_id=?').get(vid);
    if (!u) return res.status(404).render('verify', { title: 'ID Verification', found: false, vid });
    const state = access.idState(u);
    res.render('verify', { title: 'ID Verification', found: true, vid, v: { name: u.name, role: 'Volunteer', country: u.country, state, until: u.id_expires_at } });
  });
};

let _dummy;
function DUMMY_HASH(config) {
  if (!_dummy) _dummy = ['scrypt', config.scryptN, 8, 1, Buffer.alloc(16).toString('base64'), Buffer.alloc(64).toString('base64')].join('$');
  return _dummy;
}
