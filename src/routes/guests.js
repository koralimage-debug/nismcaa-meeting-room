'use strict';
/**
 * Guests = sponsors and vendors. Deliberately small: sign up, sign in, and one page
 * (the Guest Meeting Room) that lists only the meetings addressed to them.
 * Guests never get the course, test, chat, notes, plan, volunteer lists or any child-protection material.
 */
const { now, audit } = require('../db');
const { GUEST_KINDS } = require('../config');
const { meetingsFor } = require('../meetings');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = function (app, ctx) {
  const { db, sessions, config, sec, access } = ctx;

  // Public welcome page for guests
  app.get('/guests', (req, res) => {
    if (access.isGuest(req.user)) return res.redirect('/guest');
    res.render('guests', { title: 'Sponsors and Vendors' });
  });
  app.get('/guests/sign-in', (req, res) => {
    if (req.user) return res.redirect(access.isGuest(req.user) ? '/guest' : '/meeting-room');
    res.render('sign-in', { title: 'Guest sign in', error: null, email: '', next: '', guest: true });
  });

  app.get('/guests/sign-up', (req, res) => {
    if (req.user) return res.redirect(access.isGuest(req.user) ? '/guest' : '/meeting-room');
    res.render('guest-sign-up', { title: 'Guest sign up', errors: [], v: {} });
  });
  app.post('/guests/sign-up', ctx.limiters.signup.middleware(), async (req, res) => {
    if (req.user) return res.redirect(access.isGuest(req.user) ? '/guest' : '/meeting-room');
    const b = req.body || {};
    const v = { name: String(b.name || '').trim(), organization: String(b.organization || '').trim(), kind: String(b.kind || ''), email: String(b.email || '').trim().toLowerCase(), note: String(b.note || '').trim() };
    const errors = [];
    if (v.name.length < 2 || v.name.length > 100) errors.push('Please enter your name.');
    if (v.organization.length < 2 || v.organization.length > 120) errors.push('Please enter your organization.');
    if (!GUEST_KINDS[v.kind]) errors.push('Please choose Sponsor or Vendor.');
    if (!EMAIL_RE.test(v.email) || v.email.length > 200) errors.push('Please enter a valid e-mail address. It will be your sign-in ID.');
    const pw = sec.passwordProblem(b.password);
    if (pw) errors.push(pw);
    if (v.note.length > 300) errors.push('Please keep the note to one or two sentences (300 characters).');
    if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email=?').get(v.email)) errors.push('An account with this e-mail already exists. Please sign in instead.');
    if (errors.length) return res.status(400).render('guest-sign-up', { title: 'Guest sign up', errors, v });
    const hash = await sec.hashPassword(b.password, config);
    const r = db.transaction(() => {
      const u = db.prepare("INSERT INTO users(email,name,pw_hash,role,status,age_confirmed,created_at) VALUES (?,?,?, 'guest', 'guest_pending', 1, ?)").run(v.email, v.name, hash, now());
      db.prepare('INSERT INTO guests(user_id,organization,kind,country,offer_note) VALUES (?,?,?,?,?)').run(u.lastInsertRowid, v.organization, v.kind, '', v.note);
      return u;
    })();
    audit(db, 'guest_signup', r.lastInsertRowid, v.email, `${v.kind}: ${v.organization}`);
    sessions.login(req, res, r.lastInsertRowid);
    db.prepare('UPDATE sessions SET flash=? WHERE user_id=?').run(JSON.stringify({ type: 'ok', msg: 'Thank you. Your request was sent. An administrator will approve it soon.' }), r.lastInsertRowid);
    res.redirect('/guest');
  });

  // The one guest page
  app.get('/guest', (req, res) => {
    if (!req.user) return res.redirect('/sign-in?next=/guest');
    if (access.isAdmin(req.user)) return res.redirect('/admin/meetings');
    if (!access.isGuest(req.user)) return res.status(403).render('error', { title: 'Guests only', message: 'This page is only for approved sponsors and vendors.' });
    res.locals.mainTab = 'guest';
    const g = db.prepare('SELECT * FROM guests WHERE user_id=?').get(req.user.id) || {};
    const { upcoming } = meetingsFor(db, req.user, access);
    res.render('guest-room', { title: 'Guest Meeting Room', g, meetings: upcoming, approved: access.hasGuestAccess(req.user) });
  });
};
