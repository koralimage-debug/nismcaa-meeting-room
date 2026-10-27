'use strict';
/** Admin area: waiting list, approval, people, ID renewal, answer key, settings, heads, log, exports. */
const { now, audit, getSetting, setSetting, nextVolunteerId } = require('../db');
const { COUNTRIES, DEPARTMENTS, NOT_LISTED } = require('../config');
const { regradePending, keyComplete } = require('./course');
const { sendCsv } = require('../csv');

const addYear = (fromMs) => { const d = new Date(fromMs); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString(); };
const isHttps = (s) => { try { const u = new URL(s); return u.protocol === 'https:'; } catch (e) { return false; } };

module.exports = function (app, ctx) {
  const { db, sec, config, access } = ctx;

  // Everything under /admin (except /admin/claim, handled earlier) needs an admin.
  app.use('/admin', (req, res, next) => {
    if (req.path === '/claim') return next();
    if (!req.user) return res.redirect('/sign-in?next=' + encodeURIComponent(req.originalUrl.split('?')[0]));
    if (!access.isAdmin(req.user)) return res.status(403).render('error', { title: 'Admins only', message: 'This area is only for NISMCAA administrators.' });
    res.locals.mainTab = 'admin';
    next();
  });

  const person = (id) => db.prepare("SELECT * FROM users WHERE id=? AND role='volunteer'").get(id);
  const back = (res, url) => res.redirect(url);

  // ---------------- dashboard ----------------
  app.get('/admin', (req, res) => {
    const c = (s) => db.prepare('SELECT COUNT(*) c FROM users WHERE status=?').get(s).c;
    res.render('admin/index', {
      title: 'Admin', counts: { waiting: c('waiting'), applicant: c('applicant'), interest: c('interest'), approved: c('approved'), declined: c('declined'), ended: c('ended') },
      keyReady: keyComplete(db), keyCount: db.prepare("SELECT COUNT(*) c FROM questions WHERE answer_key<>''").get().c,
      pendingAttempts: db.prepare("SELECT COUNT(*) c FROM attempts WHERE result='pending'").get().c,
      claimOpen: db.prepare('SELECT COUNT(*) c FROM claim_codes WHERE used_at IS NULL').get().c,
    });
  });

  // ---------------- waiting for approval ----------------
  app.get('/admin/pending', (req, res) => {
    const rows = db.prepare(`SELECT u.*, (SELECT MAX(score) FROM attempts a WHERE a.user_id=u.id AND a.passed=1) best,
        (SELECT MIN(created_at) FROM attempts a WHERE a.user_id=u.id AND a.passed=1) passed_at,
        (SELECT child_correct FROM attempts a WHERE a.user_id=u.id AND a.passed=1 ORDER BY score DESC LIMIT 1) child
      FROM users u WHERE u.status='waiting' ORDER BY passed_at`).all();
    res.render('admin/pending', { title: 'Waiting for approval', rows });
  });

  app.post('/admin/pending/:id/approve', (req, res) => {
    const u = person(req.params.id);
    if (!u || u.status !== 'waiting') { req.flash('err', 'That person is not waiting for approval.'); return back(res, '/admin/pending'); }
    const country = String(req.body.country || ''); const dept = String(req.body.department || '');
    if (!COUNTRIES.includes(country)) { req.flash('err', 'Please choose one of the six supported countries before approving.'); return back(res, '/admin/pending'); }
    if (!DEPARTMENTS.includes(dept)) { req.flash('err', 'Please choose a department.'); return back(res, '/admin/pending'); }
    const vid = nextVolunteerId(db);
    const issued = now();
    db.prepare(`UPDATE users SET status='approved', country=?, department=?, volunteer_id=?, id_issued_at=?, id_expires_at=?, id_status='active',
                approved_by=?, decline_reason=NULL WHERE id=?`).run(country, dept, vid, issued, addYear(Date.now()), req.user.id, u.id);
    audit(db, 'approve', req.user.id, u.email, `${vid}; country ${country}${country !== u.country_chosen ? ` (volunteer chose: ${u.country_chosen}; corrected by admin)` : ''}; department ${dept}`);
    req.flash('ok', `${u.name} is approved. ID: ${vid}.`);
    back(res, '/admin/pending');
  });

  app.post('/admin/pending/:id/decline', (req, res) => {
    const u = person(req.params.id);
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!u || !['waiting', 'interest', 'applicant'].includes(u.status)) { req.flash('err', 'That person cannot be declined now.'); return back(res, '/admin/pending'); }
    if (!reason) { req.flash('err', 'Please write a private reason (only admins see it).'); return back(res, req.body.from || '/admin/pending'); }
    db.prepare("UPDATE users SET status='declined', decline_reason=? WHERE id=?").run(reason, u.id);
    audit(db, 'decline', req.user.id, u.email, reason);
    req.flash('ok', `${u.name} was declined.`);
    back(res, req.body.from === '/admin/people' ? '/admin/people' : '/admin/pending');
  });

  // ---------------- people ----------------
  app.get('/admin/people', (req, res) => {
    const status = String(req.query.status || ''); const q = String(req.query.q || '').trim();
    const where = ["role='volunteer'"]; const args = [];
    if (status) { where.push('status=?'); args.push(status); }
    if (q) { where.push('(name LIKE ? OR email LIKE ? OR volunteer_id LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const rows = db.prepare(`SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`).all(...args);
    res.render('admin/people', { title: 'People', rows, status, q });
  });

  app.get('/admin/people/:id', (req, res) => {
    const u = person(req.params.id);
    if (!u) return res.status(404).render('error', { title: 'Not found', message: 'No such person.' });
    const attempts = db.prepare('SELECT id, score, child_correct, result, created_at FROM attempts WHERE user_id=? ORDER BY id DESC').all(u.id);
    const log = db.prepare("SELECT * FROM audit_log WHERE target=? ORDER BY id DESC LIMIT 50").all(u.email);
    res.render('admin/person', { title: u.name, p: u, attempts, log, temp: null });
  });

  // Admin may change country/department at any time (a volunteer never can). Always logged.
  app.post('/admin/people/:id/placement', (req, res) => {
    const u = person(req.params.id); if (!u) return back(res, '/admin/people');
    const country = String(req.body.country || ''); const dept = String(req.body.department || '');
    if (!COUNTRIES.includes(country) || !DEPARTMENTS.includes(dept)) { req.flash('err', 'Choose a supported country and a department.'); return back(res, '/admin/people/' + u.id); }
    db.prepare('UPDATE users SET country=?, department=? WHERE id=?').run(country, dept, u.id);
    // a head seat in the old place no longer fits
    db.prepare('UPDATE heads SET user_id=NULL, assigned_at=NULL WHERE user_id=? AND NOT (country=? AND department=?)').run(u.id, country, dept);
    audit(db, 'placement', req.user.id, u.email, `country ${u.country || '-'} -> ${country}; department ${u.department || '-'} -> ${dept}`);
    req.flash('ok', 'Placement saved.');
    back(res, '/admin/people/' + u.id);
  });

  // Interest list: assign a supported country so the person can take the test.
  app.post('/admin/people/:id/assign-country', (req, res) => {
    const u = person(req.params.id);
    const country = String(req.body.country || '');
    if (!u || u.status !== 'interest' || !COUNTRIES.includes(country)) { req.flash('err', 'Choose a supported country for a person on the interest list.'); return back(res, '/admin/people'); }
    db.prepare("UPDATE users SET country_chosen=?, status='applicant' WHERE id=?").run(country, u.id);
    audit(db, 'country_assigned', req.user.id, u.email, `interest list -> ${country}; now an applicant`);
    req.flash('ok', `${u.name} can now take the final test (country: ${country}).`);
    back(res, '/admin/people/' + u.id);
  });

  app.post('/admin/people/:id/reset-password', async (req, res) => {
    const u = person(req.params.id); if (!u) return back(res, '/admin/people');
    const temp = sec.randomPassword();
    db.prepare('UPDATE users SET pw_hash=?, must_change_pw=1 WHERE id=?').run(await sec.hashPassword(temp, config), u.id);
    ctx.sessions.endAllForUser(u.id);
    ctx.lockout.clear(u.email);
    audit(db, 'password_reset', req.user.id, u.email, 'temporary password issued (not stored in the log)');
    const attempts = db.prepare('SELECT id, score, child_correct, result, created_at FROM attempts WHERE user_id=? ORDER BY id DESC').all(u.id);
    // shown ONCE on this page, to the admin only
    res.set('Cache-Control', 'no-store');
    res.render('admin/person', { title: u.name, p: u, attempts, log: [], temp });
  });

  // ---- ID: renew / decline renewal / end ----
  app.post('/admin/people/:id/renew', (req, res) => {
    const u = person(req.params.id);
    if (!u || !u.volunteer_id || u.id_status === 'ended') { req.flash('err', 'This ID cannot be renewed.'); return back(res, '/admin/people'); }
    const base = Math.max(Date.now(), Date.parse(u.id_expires_at));
    db.prepare("UPDATE users SET id_expires_at=?, id_status='active', status='approved' WHERE id=?").run(addYear(base), u.id);
    audit(db, 'renew', req.user.id, u.email, `${u.volunteer_id} renewed 1 year`);
    req.flash('ok', 'ID renewed for 1 year.'); back(res, '/admin/people/' + u.id);
  });
  app.post('/admin/people/:id/decline-renewal', (req, res) => {
    const u = person(req.params.id);
    if (!u || !u.volunteer_id || u.id_status === 'ended') return back(res, '/admin/people');
    db.prepare("UPDATE users SET id_status='renewal_declined' WHERE id=?").run(u.id);
    audit(db, 'renewal_declined', req.user.id, u.email, `${u.volunteer_id}: renewal declined (valid until ${u.id_expires_at.slice(0, 10)})`);
    req.flash('ok', 'Renewal declined. The ID stays valid until its end date.'); back(res, '/admin/people/' + u.id);
  });
  app.post('/admin/people/:id/end-id', (req, res) => {
    const u = person(req.params.id);
    if (!u || !u.volunteer_id) return back(res, '/admin/people');
    db.prepare("UPDATE users SET id_status='ended', status='ended' WHERE id=?").run(u.id);
    db.prepare('UPDATE heads SET user_id=NULL, assigned_at=NULL WHERE user_id=?').run(u.id);
    audit(db, 'end_id', req.user.id, u.email, `${u.volunteer_id} ended`);
    req.flash('ok', 'ID ended. This person no longer has Meeting Room access.'); back(res, '/admin/people/' + u.id);
  });

  // ---------------- answer key ----------------
  app.get('/admin/key', (req, res) => {
    const qs = db.prepare('SELECT * FROM questions ORDER BY num').all().map((q) => ({ ...q, options: JSON.parse(q.options) }));
    res.render('admin/key', { title: 'Answer key', qs, keyReady: keyComplete(db), pendingAttempts: db.prepare("SELECT COUNT(*) c FROM attempts WHERE result='pending'").get().c });
  });
  app.post('/admin/key', (req, res) => {
    const text = String(req.body.key || '');
    const found = {};
    const re = /(?:^|[\s,;])(\d{1,2})\s*[:.)=\-]?\s*([A-Da-d])(?=$|[\s,;.])/g;
    let m; while ((m = re.exec(text))) found[Number(m[1])] = m[2].toUpperCase();
    const qs = db.prepare('SELECT num, options FROM questions').all();
    const bad = []; const upd = db.prepare('UPDATE questions SET answer_key=? WHERE num=?');
    db.transaction(() => {
      for (const [n, letter] of Object.entries(found)) {
        const q = qs.find((x) => x.num === Number(n));
        if (!q || !JSON.parse(q.options).some((o) => o.letter === letter)) bad.push(`${n}:${letter}`); else upd.run(letter, q.num);
      }
    })();
    if (!Object.keys(found).length) req.flash('err', 'No answers found. Use one per line like "1:B", "2:A", ... "50:C".');
    else {
      audit(db, 'key_update', req.user.id, 'answer key', `${Object.keys(found).length - bad.length} entries saved${bad.length ? `; rejected: ${bad.join(' ')}` : ''}`);
      req.flash(bad.length ? 'err' : 'ok', `Saved ${Object.keys(found).length - bad.length} answers.${bad.length ? ' Not accepted (letter does not exist for that question): ' + bad.join(', ') : ''}`);
    }
    back(res, '/admin/key');
  });
  app.post('/admin/key/regrade', (req, res) => {
    const n = regradePending(db);
    if (n < 0) req.flash('err', 'The answer key is not complete yet (all 50 answers are needed).');
    else { audit(db, 'regrade', req.user.id, 'answer key', `${n} saved attempts graded`); req.flash('ok', `Graded ${n} saved attempt(s).`); }
    back(res, '/admin/key');
  });

  // ---------------- settings: call links, QR base ----------------
  app.get('/admin/settings', (req, res) => {
    const links = Object.fromEntries(db.prepare('SELECT country, url FROM country_links').all().map((r) => [r.country, r.url]));
    res.render('admin/settings', { title: 'Settings', main: getSetting(db, 'call_link_main'), links, qr: getSetting(db, 'qr_base_url', config.publicUrl ? config.publicUrl + '/verify/' : '') });
  });
  app.post('/admin/settings', (req, res) => {
    const main = String(req.body.main || '').trim();
    const fields = [['Main link', main], ...COUNTRIES.map((c) => [c, String(req.body['link_' + c.replace(/ /g, '_')] || '').trim()])];
    const bad = fields.filter(([, v]) => v && !isHttps(v));
    const qr = String(req.body.qr || '').trim();
    if (qr && !isHttps(qr) && !/^http:\/\/localhost[:/]/.test(qr)) bad.push(['QR address', qr]);
    if (bad.length) { req.flash('err', 'These addresses must start with https:// : ' + bad.map((b) => b[0]).join(', ')); return back(res, '/admin/settings'); }
    setSetting(db, 'call_link_main', main);
    for (const c of COUNTRIES) {
      const v = String(req.body['link_' + c.replace(/ /g, '_')] || '').trim();
      if (v) db.prepare('INSERT INTO country_links(country,url) VALUES (?,?) ON CONFLICT(country) DO UPDATE SET url=excluded.url').run(c, v);
      else db.prepare('DELETE FROM country_links WHERE country=?').run(c);
    }
    setSetting(db, 'qr_base_url', qr);
    audit(db, 'settings', req.user.id, 'settings', 'call links / QR address updated');
    req.flash('ok', 'Settings saved.'); back(res, '/admin/settings');
  });

  // ---------------- head seats ----------------
  app.get('/admin/heads', (req, res) => {
    const seats = db.prepare('SELECT h.*, u.name head_name FROM heads h LEFT JOIN users u ON u.id=h.user_id').all();
    const cand = db.prepare(`SELECT u.id, u.name, u.country, u.department FROM users u WHERE u.status='approved' AND u.id_status<>'ended'
      AND EXISTS (SELECT 1 FROM attempts a WHERE a.user_id=u.id AND a.passed=1) ORDER BY u.name`).all();
    res.render('admin/heads', { title: 'Head seats', seats, cand });
  });
  app.post('/admin/heads', (req, res) => {
    const country = String(req.body.country || ''); const dept = String(req.body.department || '');
    const uid = req.body.user_id ? Number(req.body.user_id) : null;
    if (!COUNTRIES.includes(country) || !DEPARTMENTS.includes(dept)) return back(res, '/admin/heads');
    if (uid) {
      const ok = db.prepare(`SELECT 1 FROM users u WHERE u.id=? AND u.status='approved' AND u.country=? AND u.id_status<>'ended'
        AND EXISTS (SELECT 1 FROM attempts a WHERE a.user_id=u.id AND a.passed=1)`).get(uid, country);
      if (!ok) { req.flash('err', 'A head must be an approved volunteer of that country who passed the course.'); return back(res, '/admin/heads'); }
      db.prepare('UPDATE heads SET user_id=?, assigned_at=? WHERE country=? AND department=?').run(uid, now(), country, dept);
      audit(db, 'head_assigned', req.user.id, `${country} / ${dept}`, `user ${uid}`);
    } else {
      db.prepare('UPDATE heads SET user_id=NULL, assigned_at=NULL WHERE country=? AND department=?').run(country, dept);
      audit(db, 'head_removed', req.user.id, `${country} / ${dept}`, 'seat emptied');
    }
    req.flash('ok', 'Head seat updated.'); back(res, '/admin/heads#' + encodeURIComponent(country));
  });

  // ---------------- log + exports ----------------
  app.get('/admin/log', (req, res) => {
    const kind = String(req.query.kind || '');
    const rows = db.prepare(`SELECT l.*, u.name actor FROM audit_log l LEFT JOIN users u ON u.id=l.actor_id ${kind ? 'WHERE l.kind=?' : ''} ORDER BY l.id DESC LIMIT 400`).all(...(kind ? [kind] : []));
    const kinds = db.prepare('SELECT DISTINCT kind FROM audit_log ORDER BY kind').all().map((r) => r.kind);
    res.render('admin/log', { title: 'Change log', rows, kind, kinds });
  });
  app.get('/admin/export/users.csv', (req, res) => {
    const rows = db.prepare("SELECT * FROM users WHERE role='volunteer' ORDER BY id").all();
    sendCsv(res, 'meeting-room-people.csv', ['Name', 'Email', 'Phone', 'Status', 'Country chosen', 'Country', 'Department', 'Volunteer ID', 'ID issued', 'ID expires', 'ID status', 'Signed up'],
      rows.map((u) => [u.name, u.email, u.phone, u.status, u.country_chosen, u.country, u.department, u.volunteer_id, u.id_issued_at, u.id_expires_at, u.id_status, u.created_at]));
  });
  app.get('/admin/export/attempts.csv', (req, res) => {
    const rows = db.prepare('SELECT a.*, u.name, u.email FROM attempts a JOIN users u ON u.id=a.user_id ORDER BY a.id').all();
    sendCsv(res, 'meeting-room-test-attempts.csv', ['Name', 'Email', 'Score (of 50)', 'Child protection (of 10)', 'Result', 'Passed', 'Date'],
      rows.map((a) => [a.name, a.email, a.score, a.child_correct, a.result === 'pending' ? 'pending key' : a.result, a.passed ? 'yes' : 'no', a.created_at]));
  });
  app.get('/admin/export/log.csv', (req, res) => {
    const rows = db.prepare('SELECT l.*, u.name actor FROM audit_log l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.id').all();
    sendCsv(res, 'meeting-room-change-log.csv', ['When', 'Type', 'By', 'About', 'Detail'], rows.map((l) => [l.created_at, l.kind, l.actor, l.target, l.detail]));
  });
};
