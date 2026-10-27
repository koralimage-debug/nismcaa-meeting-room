'use strict';
/** Action plan, tasks, work logs, head seats and remarks. */
const { now, audit, getSetting } = require('../db');
const { COUNTRIES, DEPARTMENTS, PLAN_STATUSES, slug } = require('../config');
const { isAdmin } = require('../access');
const { flagFor, summarize } = require('../plan');
const { sendCsv } = require('../csv');

const C_BY_SLUG = Object.fromEntries(COUNTRIES.map((c) => [slug(c), c]));
const D_BY_SLUG = Object.fromEntries(DEPARTMENTS.map((d) => [slug(d), d]));
const dateOk = (s) => s === '' || s == null || /^\d{4}-\d{2}-\d{2}$/.test(s);

module.exports = function (app, ctx) {
  const { db } = ctx;
  const needRoom = (req, res, next) => ctx.needRoom(req, res, next);

  const forbidden = (res, msg) => res.status(403).render('error', { title: 'No access', message: msg || 'You do not have access to that.' });
  const canSeeCountry = (u, country) => isAdmin(u) || u.country === country;
  const seat = (country, dept) => db.prepare('SELECT h.*, u.name head_name FROM heads h LEFT JOIN users u ON u.id=h.user_id WHERE h.country=? AND h.department=?').get(country, dept);
  const isHead = (u, country, dept) => { const s = seat(country, dept); return !!(s && s.user_id === u.id); };
  const isMemberOf = (u, country, dept) => u.country === country && u.department === dept;
  const canRemark = (u, country, dept) => isAdmin(u) || isHead(u, country, dept);

  function loadTasks(country, dept) {
    const rows = db.prepare(`SELECT t.*, o.name owner_name FROM tasks t LEFT JOIN users o ON o.id=t.owner_user_id
      WHERE t.country=? ${dept ? 'AND t.department=?' : ''} ORDER BY t.sort, t.id`).all(...(dept ? [country, dept] : [country]));
    if (!dept) rows.sort((a, b) => DEPARTMENTS.indexOf(a.department) - DEPARTMENTS.indexOf(b.department) || a.sort - b.sort || a.id - b.id);
    const today = ctx.todayStr();
    rows.forEach((t) => { if (t.row_type === 'task') t.f = flagFor(t, today); });
    return rows;
  }
  const deptMembers = (country, dept) => db.prepare("SELECT id, name, volunteer_id FROM users WHERE status='approved' AND id_status<>'ended' AND country=? AND department=? ORDER BY name").all(country, dept);
  const countryMembers = (country) => db.prepare("SELECT id, name, department FROM users WHERE status='approved' AND id_status<>'ended' AND country=? ORDER BY name").all(country);

  function logPlan(actor, task, detail) {
    audit(db, 'plan_edit', actor.id, `${task.country} / ${task.department} / #${task.seq}`, detail);
  }

  // ---------- entry ----------
  app.get('/meeting-room/plan', needRoom, (req, res) => {
    if (isAdmin(req.user)) return res.redirect('/meeting-room/plan/global');
    res.redirect(`/meeting-room/plan/${slug(req.user.country)}/all`);
  });

  app.get('/meeting-room/plan/about', needRoom, (req, res) => {
    let about = []; try { about = JSON.parse(getSetting(db, 'plan_about', '[]')); } catch (e) { /* ignore */ }
    res.render('plan/about', { title: 'About this plan', about, proposed: getSetting(db, 'plan_proposed') });
  });

  app.get('/meeting-room/plan/global', needRoom, (req, res) => {
    if (!isAdmin(req.user)) return forbidden(res, 'The global roll-up is only for administrators.');
    const today = ctx.todayStr();
    const perCountry = COUNTRIES.map((c) => ({ country: c, slug: slug(c), s: summarize(loadTasks(c, null), today) }));
    const total = perCountry.reduce((a, p) => { ['total', 'done', 'red', 'amber', 'green', 'grey'].forEach((k) => { a[k] += p.s[k]; }); return a; }, { total: 0, done: 0, red: 0, amber: 0, green: 0, grey: 0 });
    res.render('plan/global', { title: 'Global roll-up', perCountry, total, today });
  });
  app.get('/meeting-room/plan/global.csv', needRoom, (req, res) => {
    if (!isAdmin(req.user)) return forbidden(res);
    const today = ctx.todayStr();
    sendCsv(res, 'action-plan-global.csv', ['Country', 'Tasks', 'Done', 'Red', 'Amber', 'Green', 'Not flagged', 'Owners behind'],
      COUNTRIES.map((c) => { const s = summarize(loadTasks(c, null), today); return [c, s.total, s.done, s.red, s.amber, s.green, s.grey, s.owners.join('; ')]; }));
  });

  app.get('/meeting-room/plan/log', needRoom, (req, res) => {
    if (!isAdmin(req.user)) return forbidden(res, 'The change log is only for administrators.');
    const rows = db.prepare("SELECT l.*, u.name actor FROM audit_log l LEFT JOIN users u ON u.id=l.actor_id WHERE l.kind LIKE 'plan_%' ORDER BY l.id DESC LIMIT 400").all();
    res.render('plan/log', { title: 'Action plan change log', rows });
  });

  // ---------- one tab (a department or "all") ----------
  function resolve(req, res) {
    const country = C_BY_SLUG[req.params.country];
    const all = req.params.dept === 'all';
    const dept = all ? null : D_BY_SLUG[req.params.dept];
    if (!country || (!all && !dept)) { res.status(404).render('error', { title: 'Not found', message: 'No such plan tab.' }); return null; }
    if (!canSeeCountry(req.user, country)) { forbidden(res, "You can only open your own country's plan."); return null; }
    return { country, dept };
  }

  app.get('/meeting-room/plan/:country/:dept', needRoom, (req, res) => {
    const r = resolve(req, res); if (!r) return;
    const { country, dept } = r; const u = req.user; const today = ctx.todayStr();
    const tasks = loadTasks(country, dept);
    const summary = summarize(tasks, today);
    const data = { title: `${country}: ${dept || 'All departments'}`, proposed: getSetting(db, 'plan_proposed'), country, cslug: slug(country), dept, tasks, summary, today, statuses: PLAN_STATUSES, canEditAll: isAdmin(u), me: u };
    if (dept) {
      const head = seat(country, dept);
      const members = deptMembers(country, dept);
      const remarkers = canRemark(u, country, dept);
      let remarks = [];
      let noRemark = [];
      if (remarkers) {
        remarks = db.prepare(`SELECT r.*, m.name member, a.name author FROM remarks r JOIN users m ON m.id=r.member_id JOIN users a ON a.id=r.author_id
          WHERE r.country=? AND r.department=? ORDER BY r.id DESC LIMIT 100`).all(country, dept);
        noRemark = members.filter((m) => !remarks.some((x) => x.member_id === m.id));
      } else {
        remarks = db.prepare(`SELECT r.*, m.name member, a.name author FROM remarks r JOIN users m ON m.id=r.member_id JOIN users a ON a.id=r.author_id
          WHERE r.country=? AND r.department=? AND r.member_id=? ORDER BY r.id DESC`).all(country, dept, u.id);
      }
      Object.assign(data, { head, members, remarkers, remarks, noRemark, actingAdmins: !head.user_id, ownerChoices: isAdmin(u) ? countryMembers(country) : [] });
    } else {
      const byDept = DEPARTMENTS.map((d) => ({ dept: d, slug: slug(d), s: summarize(tasks.filter((t) => t.department === d), today) }));
      Object.assign(data, { byDept });
    }
    res.render('plan/tab', data);
  });

  app.get('/meeting-room/plan/:country/:dept/export.csv', needRoom, (req, res) => {
    const r = resolve(req, res); if (!r) return;
    const { country, dept } = r;
    const tasks = loadTasks(country, dept).filter((t) => t.row_type === 'task');
    sendCsv(res, `action-plan-${slug(country)}-${dept ? slug(dept) : 'all-departments'}.csv`,
      ['Department', 'No.', 'Task', 'Owner', 'Start', 'Deadline (planned finish)', 'Hard limit', 'Status', '% progress', 'Flag', 'Final 4 weeks', 'Notes'],
      tasks.map((t) => [t.department, t.seq, t.title, t.owner_name ? `${t.owner} (${t.owner_name})` : t.owner, t.start_date, t.deadline, t.hard_limit, t.status, t.progress, t.f.label, t.final4 ? 'yes' : '', t.notes]));
  });

  // ---------- tasks ----------
  const loadTask = (id) => db.prepare('SELECT t.*, o.name owner_name FROM tasks t LEFT JOIN users o ON o.id=t.owner_user_id WHERE t.id=?').get(Number(id));
  function taskAccess(req, res) {
    const t = loadTask(req.params.id);
    if (!t) { res.status(404).render('error', { title: 'Not found', message: 'No such task.' }); return null; }
    if (!canSeeCountry(req.user, t.country)) { forbidden(res, "You can only open your own country's plan."); return null; }
    return t;
  }
  const tabUrl = (t) => `/meeting-room/plan/${slug(t.country)}/${slug(t.department)}`;

  app.get('/meeting-room/task/:id', needRoom, (req, res) => {
    const t = taskAccess(req, res); if (!t) return;
    const u = req.user; const canLogHere = isAdmin(u) || isHead(u, t.country, t.department) || isMemberOf(u, t.country, t.department);
    const seeAllLogs = isAdmin(u) || isHead(u, t.country, t.department);
    const entries = db.prepare(`SELECT w.*, x.name FROM worklog w JOIN users x ON x.id=w.user_id WHERE w.task_id=? ${seeAllLogs ? '' : 'AND w.user_id=?'} ORDER BY w.entry_date DESC, w.id DESC`).all(...(seeAllLogs ? [t.id] : [t.id, u.id]));
    t.f = t.row_type === 'task' ? flagFor(t, ctx.todayStr()) : null;
    res.render('plan/task', { title: `Task ${t.seq}`, t, entries, canLogHere, seeAllLogs, today: ctx.todayStr(), statuses: PLAN_STATUSES, isOwner: t.owner_user_id === u.id, ownerChoices: isAdmin(u) ? countryMembers(t.country) : [], tabUrl: tabUrl(t) });
  });

  app.post('/meeting-room/task/:id/update', needRoom, (req, res) => {
    const t = taskAccess(req, res); if (!t || t.row_type !== 'task') return;
    const u = req.user; const b = req.body; const admin = isAdmin(u); const owner = t.owner_user_id === u.id;
    if (!admin && !owner) return forbidden(res, 'Only the task owner or an administrator can change a task.');
    const next = {};
    if (b.status !== undefined) { if (!PLAN_STATUSES.includes(b.status)) return forbidden(res, 'Unknown status.'); next.status = b.status; }
    if (b.progress !== undefined) { const p = Math.round(Number(b.progress)); if (!(p >= 0 && p <= 100)) return forbidden(res, '% progress must be 0 to 100.'); next.progress = p; }
    if (admin) {
      if (b.title !== undefined) next.title = String(b.title).trim().slice(0, 500) || t.title;
      if (b.owner !== undefined) next.owner = String(b.owner).trim().slice(0, 200);
      if (b.notes !== undefined) next.notes = String(b.notes).trim().slice(0, 2000);
      for (const f of ['start_date', 'deadline', 'hard_limit']) {
        if (b[f] !== undefined) { if (!dateOk(b[f])) return forbidden(res, 'Dates must look like 2027-03-31.'); next[f] = b[f] || null; }
      }
      if (b.owner_user_id !== undefined) {
        const id = b.owner_user_id ? Number(b.owner_user_id) : null;
        if (id && !countryMembers(t.country).some((m) => m.id === id)) return forbidden(res, 'The owner must be an approved volunteer of this country.');
        next.owner_user_id = id;
      }
    }
    const changes = [];
    for (const [k, v] of Object.entries(next)) {
      const old = t[k] == null ? '' : String(t[k]); const nv = v == null ? '' : String(v);
      if (old !== nv) changes.push([k, old, nv]);
    }
    if (changes.length) {
      db.prepare(`UPDATE tasks SET ${changes.map(([k]) => k + '=?').join(', ')} WHERE id=?`).run(...changes.map(([k]) => (next[k] === '' ? null : next[k])), t.id);
      changes.forEach(([k, o, n]) => logPlan(u, t, `${k}: "${o}" -> "${n}"`));
      req.flash('ok', 'Saved.');
    }
    res.redirect(req.body.back === 'task' ? `/meeting-room/task/${t.id}` : tabUrl(t) + `#task-${t.id}`);
  });

  app.post('/meeting-room/task/:id/delete', needRoom, (req, res) => {
    const t = taskAccess(req, res); if (!t) return;
    if (!isAdmin(req.user)) return forbidden(res, 'Only administrators can delete tasks.');
    db.prepare('DELETE FROM worklog WHERE task_id=?').run(t.id);
    db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
    audit(db, 'plan_delete', req.user.id, `${t.country} / ${t.department} / #${t.seq}`, `deleted: ${t.title}`);
    req.flash('ok', 'Task deleted.'); res.redirect(tabUrl(t));
  });

  app.post('/meeting-room/plan/:country/:dept/add', needRoom, (req, res) => {
    const r = resolve(req, res); if (!r) return;
    if (!isAdmin(req.user) || !r.dept) return forbidden(res, 'Only administrators can add tasks, inside a department tab.');
    const b = req.body; const title = String(b.title || '').trim().slice(0, 500);
    if (!title || !dateOk(b.start_date) || !dateOk(b.deadline)) { req.flash('err', 'A task needs a title; dates must look like 2027-03-31.'); return res.redirect(`/meeting-room/plan/${slug(r.country)}/${slug(r.dept)}`); }
    const max = db.prepare("SELECT COALESCE(MAX(seq),0) s, COALESCE(MAX(sort),0) o FROM tasks WHERE country=? AND department=?").get(r.country, r.dept);
    const info = db.prepare(`INSERT INTO tasks(country,department,row_type,seq,title,owner,start_date,deadline,hard_limit,status,progress,notes,sort)
      VALUES (?,?,?,?,?,?,?,?,?, 'Not started', 0, ?, ?)`).run(r.country, r.dept, 'task', max.s + 1, title, String(b.owner || 'To be appointed').trim().slice(0, 200), b.start_date || null, b.deadline || null, b.hard_limit || null, String(b.notes || '').slice(0, 2000), max.o + 1);
    audit(db, 'plan_add', req.user.id, `${r.country} / ${r.dept} / #${max.s + 1}`, `added: ${title}`);
    req.flash('ok', 'Task added.'); res.redirect(`/meeting-room/plan/${slug(r.country)}/${slug(r.dept)}#task-${info.lastInsertRowid}`);
  });

  // ---------- work log ----------
  app.post('/meeting-room/task/:id/log', needRoom, (req, res) => {
    const t = taskAccess(req, res); if (!t || t.row_type !== 'task') return;
    const u = req.user;
    if (!(isAdmin(u) || isHead(u, t.country, t.department) || isMemberOf(u, t.country, t.department))) return forbidden(res, 'Only members of this department can add work log entries.');
    const body = String(req.body.body || '').trim().slice(0, 1000);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.entry_date || '') ? req.body.entry_date : ctx.todayStr();
    if (!body) { req.flash('err', 'Write a short entry first.'); return res.redirect(`/meeting-room/task/${t.id}`); }
    db.prepare('INSERT INTO worklog(task_id,user_id,entry_date,body,created_at) VALUES (?,?,?,?,?)').run(t.id, u.id, date, body, now());
    req.flash('ok', 'Work log entry saved.'); res.redirect(`/meeting-room/task/${t.id}`);
  });
  function ownEntry(req, res) {
    const w = db.prepare('SELECT * FROM worklog WHERE id=?').get(Number(req.params.id));
    if (!w || w.user_id !== req.user.id) { forbidden(res, 'You can only change your own work log entries.'); return null; }
    return w;
  }
  app.post('/meeting-room/log/:id/edit', needRoom, (req, res) => {
    const w = ownEntry(req, res); if (!w) return;
    const body = String(req.body.body || '').trim().slice(0, 1000);
    if (body) db.prepare('UPDATE worklog SET body=? WHERE id=?').run(body, w.id);
    res.redirect(`/meeting-room/task/${w.task_id}`);
  });
  app.post('/meeting-room/log/:id/delete', needRoom, (req, res) => {
    const w = ownEntry(req, res); if (!w) return;
    db.prepare('DELETE FROM worklog WHERE id=?').run(w.id);
    res.redirect(`/meeting-room/task/${w.task_id}`);
  });

  // ---------- remarks + member page ----------
  app.post('/meeting-room/plan/:country/:dept/remark', needRoom, (req, res) => {
    const r = resolve(req, res); if (!r || !r.dept) return;
    if (!canRemark(req.user, r.country, r.dept)) return forbidden(res, 'Only the department head or an administrator can write remarks.');
    const member = Number(req.body.member_id); const body = String(req.body.body || '').trim().slice(0, 1500);
    if (!deptMembers(r.country, r.dept).some((m) => m.id === member) || !body) { req.flash('err', 'Choose a member of this department and write the remark.'); return res.redirect(`/meeting-room/plan/${slug(r.country)}/${slug(r.dept)}`); }
    db.prepare('INSERT INTO remarks(country,department,member_id,author_id,body,created_at) VALUES (?,?,?,?,?,?)').run(r.country, r.dept, member, req.user.id, body, now());
    audit(db, 'remark', req.user.id, `${r.country} / ${r.dept}`, `remark about user ${member}`);
    req.flash('ok', 'Remark saved.'); res.redirect(`/meeting-room/plan/${slug(r.country)}/${slug(r.dept)}`);
  });

  app.get('/meeting-room/member/:id', needRoom, (req, res) => {
    const m = db.prepare("SELECT id, name, volunteer_id, country, department, id_expires_at FROM users WHERE id=? AND role='volunteer' AND status IN ('approved','ended')").get(Number(req.params.id));
    if (!m) return res.status(404).render('error', { title: 'Not found', message: 'No such member.' });
    const u = req.user;
    if (!(u.id === m.id || isAdmin(u) || isHead(u, m.country, m.department))) return forbidden(res, 'You can only see your own work log and remarks.');
    const entries = db.prepare(`SELECT w.*, t.title, t.seq, t.country, t.department FROM worklog w JOIN tasks t ON t.id=w.task_id WHERE w.user_id=? ORDER BY w.entry_date DESC, w.id DESC`).all(m.id);
    const remarks = db.prepare('SELECT r.*, a.name author FROM remarks r JOIN users a ON a.id=r.author_id WHERE r.member_id=? ORDER BY r.id DESC').all(m.id);
    res.render('plan/member', { title: m.name, m, entries, remarks, self: u.id === m.id });
  });
};
