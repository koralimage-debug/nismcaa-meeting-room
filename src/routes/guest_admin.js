'use strict';
/** Admin: the Guests page (approve sponsors and vendors) and Meetings (create / edit with an audience). */
const { now, audit } = require('../db');
const { COUNTRIES, MEETING_ZONES, AUDIENCES } = require('../config');
const M = require('../meetings');

const isHttps = (s) => { try { return new URL(s).protocol === 'https:'; } catch (e) { return false; } };

module.exports = function (app, ctx) {
  const { db, sec, config, access } = ctx;

  // Own admin check on top of the /admin guard in admin.js (defense in depth).
  const needAdmin = (req, res, next) => {
    if (!req.user) return res.redirect('/sign-in?next=' + encodeURIComponent(req.originalUrl.split('?')[0]));
    if (!access.isAdmin(req.user)) return res.status(403).render('error', { title: 'Admins only', message: 'This area is only for NISMCAA administrators.' });
    res.locals.mainTab = 'admin';
    next();
  };

  // ---------------- Guests ----------------
  const guestRows = () => db.prepare(`SELECT u.id, u.name, u.email, u.status, u.created_at, g.organization, g.kind, g.offer_note
    FROM users u JOIN guests g ON g.user_id=u.id WHERE u.role='guest'
    ORDER BY CASE u.status WHEN 'guest_pending' THEN 0 ELSE 1 END, u.created_at DESC`).all();
  const guestPage = (res, extra = {}) => res.render('admin/guests', { title: 'Guests', rows: guestRows(), temp: null, tempFor: null, ...extra });
  const getGuest = (id) => db.prepare("SELECT * FROM users WHERE id=? AND role='guest'").get(Number(id));

  app.get('/admin/guests', needAdmin, (req, res) => guestPage(res));

  const decide = (name, from, to, verb) => app.post(`/admin/guests/:id/${name}`, needAdmin, (req, res) => {
    const u = getGuest(req.params.id);
    if (!u || !from.includes(u.status)) { req.flash('err', 'That guest cannot be changed this way right now.'); return res.redirect('/admin/guests'); }
    db.prepare('UPDATE users SET status=? WHERE id=?').run(to, u.id);
    db.prepare('UPDATE guests SET decided_by=?, decided_at=? WHERE user_id=?').run(req.user.id, now(), u.id);
    if (to !== 'guest_approved') ctx.sessions.endAllForUser(u.id); // sign them out right away
    audit(db, 'guest_' + name, req.user.id, u.email, verb);
    req.flash('ok', `${u.name}: ${verb}.`);
    res.redirect('/admin/guests');
  });
  decide('approve', ['guest_pending', 'guest_rejected', 'guest_suspended'], 'guest_approved', 'approved');
  decide('reject', ['guest_pending'], 'guest_rejected', 'not approved');
  decide('suspend', ['guest_approved'], 'guest_suspended', 'suspended');

  app.post('/admin/guests/:id/reset-password', needAdmin, async (req, res) => {
    const u = getGuest(req.params.id); if (!u) return res.redirect('/admin/guests');
    const temp = sec.randomPassword();
    db.prepare('UPDATE users SET pw_hash=?, must_change_pw=1 WHERE id=?').run(await sec.hashPassword(temp, config), u.id);
    ctx.sessions.endAllForUser(u.id); ctx.lockout.clear(u.email);
    audit(db, 'guest_password_reset', req.user.id, u.email, 'temporary password issued (not stored in the log)');
    res.set('Cache-Control', 'no-store');
    guestPage(res, { temp, tempFor: u.name });
  });

  // ---------------- Meetings ----------------
  const approvedGuests = () => db.prepare(`SELECT u.id, u.name, g.organization, g.kind FROM users u JOIN guests g ON g.user_id=u.id
    WHERE u.role='guest' AND u.status='guest_approved' ORDER BY g.organization, u.name`).all();
  const audienceLabel = (m) => (m.audience === 'volunteers' ? 'Volunteers' + (m.country ? ' (' + m.country + ' team)' : ' (all teams)') : AUDIENCES[m.audience]);

  app.get('/admin/meetings', needAdmin, (req, res) => {
    const all = db.prepare('SELECT * FROM meetings ORDER BY starts_at').all().map((m) => ({
      ...M.decorate(db, m), label: audienceLabel(m), over: M.endMs(m) < Date.now(),
      invited: m.audience === 'invited' ? db.prepare('SELECT u.name, g.organization FROM meeting_invites i JOIN users u ON u.id=i.user_id JOIN guests g ON g.user_id=u.id WHERE i.meeting_id=? ORDER BY g.organization').all(m.id) : [],
    }));
    res.render('admin/meetings', { title: 'Meetings', upcoming: all.filter((m) => !m.over), past: all.filter((m) => m.over).reverse() });
  });

  const form = (res, o) => res.status(o.errors && o.errors.length ? 400 : 200).render('admin/meeting-form', {
    title: o.v.id ? 'Edit meeting' : 'New meeting', errors: [], zones: MEETING_ZONES, guests: approvedGuests(), AUDIENCES, ...o });
  const blank = () => ({ title: '', audience: 'sponsors', country: '', date: '', time: '10:00', tz: config.displayTz, agenda: '', link: '', invitees: [] });

  app.get('/admin/meetings/new', needAdmin, (req, res) => form(res, { v: blank(), errors: [] }));
  app.get('/admin/meetings/:id/edit', needAdmin, (req, res) => {
    const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(Number(req.params.id));
    if (!m) return res.status(404).render('error', { title: 'Not found', message: 'No such meeting.' });
    const l = M.utcIsoToLocal(m.starts_at, m.tz);
    form(res, { v: { id: m.id, title: m.title, audience: m.audience, country: m.country || '', date: l.date, time: l.time, tz: m.tz, agenda: m.agenda, link: m.link,
      invitees: db.prepare('SELECT user_id FROM meeting_invites WHERE meeting_id=?').all(m.id).map((r) => r.user_id) }, errors: [] });
  });

  function readMeeting(b) {
    const inv = [].concat(b.invitees || []).map(Number).filter((n) => Number.isInteger(n));
    const v = { title: String(b.title || '').trim(), audience: String(b.audience || ''), country: String(b.country || ''), date: String(b.date || ''), time: String(b.time || ''),
      tz: String(b.tz || ''), agenda: String(b.agenda || '').trim(), link: String(b.link || '').trim(), invitees: inv };
    const errors = [];
    if (v.title.length < 3 || v.title.length > 120) errors.push('Please give the meeting a title (3 to 120 characters).');
    if (!AUDIENCES[v.audience]) errors.push('Please choose who the meeting is for.');
    if (v.audience === 'volunteers' && v.country && !COUNTRIES.includes(v.country)) errors.push('Please choose a valid country team, or all teams.');
    const startsAt = M.localToUtcIso(v.date, v.time, v.tz);
    if (!startsAt) errors.push('Please enter a valid date, time and time zone.');
    if (v.agenda.length > 4000) errors.push('The agenda is too long (4000 characters at most).');
    if (!isHttps(v.link) || v.link.length > 500) errors.push('The call link must start with https:// (Zoom, Google Meet or Jitsi).');
    let invitees = [];
    if (v.audience === 'invited') {
      const ok = new Set(approvedGuests().map((g) => g.id));
      invitees = [...new Set(inv)].filter((id) => ok.has(id));
      if (!invitees.length) errors.push('Please tick at least one approved guest to invite.');
    }
    return { v, errors, startsAt, invitees };
  }
  function save(id, r, req) {
    const country = r.v.audience === 'volunteers' && r.v.country ? r.v.country : null;
    return db.transaction(() => {
      let mid = id;
      if (id) db.prepare('UPDATE meetings SET title=?,audience=?,country=?,starts_at=?,tz=?,agenda=?,link=?,updated_at=? WHERE id=?').run(r.v.title, r.v.audience, country, r.startsAt, r.v.tz, r.v.agenda, r.v.link, now(), id);
      else mid = db.prepare('INSERT INTO meetings(title,audience,country,starts_at,tz,duration_min,agenda,link,created_by,created_at) VALUES (?,?,?,?,?,60,?,?,?,?)').run(r.v.title, r.v.audience, country, r.startsAt, r.v.tz, r.v.agenda, r.v.link, req.user.id, now()).lastInsertRowid;
      db.prepare('DELETE FROM meeting_invites WHERE meeting_id=?').run(mid);
      for (const uid of r.invitees) db.prepare('INSERT INTO meeting_invites(meeting_id,user_id) VALUES (?,?)').run(mid, uid);
      return Number(mid);
    })();
  }
  app.post('/admin/meetings', needAdmin, (req, res) => {
    const r = readMeeting(req.body);
    if (r.errors.length) return form(res, { v: r.v, errors: r.errors });
    const id = save(0, r, req);
    audit(db, 'meeting_create', req.user.id, `meeting #${id}`, `${r.v.title} for ${r.v.audience}`);
    req.flash('ok', 'Meeting saved.'); res.redirect('/admin/meetings');
  });
  app.post('/admin/meetings/:id', needAdmin, (req, res) => {
    const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(Number(req.params.id));
    if (!m) return res.status(404).render('error', { title: 'Not found', message: 'No such meeting.' });
    const r = readMeeting(req.body); r.v.id = m.id;
    if (r.errors.length) return form(res, { v: r.v, errors: r.errors });
    save(m.id, r, req);
    audit(db, 'meeting_edit', req.user.id, `meeting #${m.id}`, `${r.v.title} for ${r.v.audience}`);
    req.flash('ok', 'Meeting updated.'); res.redirect('/admin/meetings');
  });
  app.post('/admin/meetings/:id/delete', needAdmin, (req, res) => {
    const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(Number(req.params.id));
    if (m) {
      db.prepare('DELETE FROM meeting_invites WHERE meeting_id=?').run(m.id); db.prepare('DELETE FROM meetings WHERE id=?').run(m.id);
      audit(db, 'meeting_delete', req.user.id, `meeting #${m.id}`, m.title);
    }
    req.flash('ok', 'Meeting deleted.'); res.redirect('/admin/meetings');
  });
};
