'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ExcelJS = require('exceljs');
const H = require('./helpers');

const XLSX = path.join(__dirname, '..', 'data', 'ACTION_PLAN_10th_Edition.xlsx');
const EXPECT = { 'Office of the Founder': 16, 'Programs & Competition': 27, 'Child Welfare & Safeguarding': 20, 'Event Operations': 25, 'Media & Communications': 27, 'Partnerships & Sponsorship': 28, 'Academy & Education': 17, 'Finance & Admin': 21, Technology: 24, 'International & Diplomacy': 17 };
let app, adm, us, ng, ng2, wb;
before(async () => {
  app = await H.startApp({ today: '2026-10-27' }); app.setFakeKey(); adm = await H.admins(app);
  us = await H.approvedVolunteer(app, adm, { name: 'Us Member', country: 'United States', dept: 'Technology' });
  ng = await H.approvedVolunteer(app, adm, { name: 'Ng Owner', country: 'Nigeria', dept: 'Technology' });
  ng2 = await H.approvedVolunteer(app, adm, { name: 'Ng Other', country: 'Nigeria', dept: 'Technology' });
  wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(XLSX);
});
after(async () => { await app.close(); });

const val = (c) => { let v = c.value; if (v && typeof v === 'object' && !(v instanceof Date)) v = 'result' in v ? v.result : v.text; return v; };
const d = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);

test('Nigeria import: 222 tasks, with the exact count per department', () => {
  const total = app.db.prepare("SELECT COUNT(*) c FROM tasks WHERE country='Nigeria' AND row_type='task'").get().c;
  assert.equal(total, 222);
  for (const [dep, n] of Object.entries(EXPECT)) assert.equal(app.db.prepare("SELECT COUNT(*) c FROM tasks WHERE country='Nigeria' AND department=? AND row_type='task'").get(dep).c, n, dep);
  assert.equal(Object.values(EXPECT).reduce((a, b) => a + b, 0), 222);
  assert.ok(app.db.prepare("SELECT COUNT(*) c FROM tasks WHERE country='Nigeria' AND row_type='phase'").get().c >= 40, 'phase heading rows kept');
});

test('every imported task matches the workbook (text, owner, dates, hard limit, status, progress, notes, final-4-weeks shading)', () => {
  let checked = 0;
  for (const dep of Object.keys(EXPECT)) {
    const ws = wb.getWorksheet(dep);
    const rows = app.db.prepare("SELECT * FROM tasks WHERE country='Nigeria' AND department=? AND row_type='task' ORDER BY sort").all(dep);
    let i = 0;
    ws.eachRow((row, n) => {
      if (n < 6 || typeof val(row.getCell(1)) !== 'number') return;
      const t = rows[i++];
      assert.equal(t.seq, val(row.getCell(1))); assert.equal(t.title, String(val(row.getCell(2))).trim());
      assert.equal(t.owner, String(val(row.getCell(3))).trim());
      assert.equal(t.start_date, d(val(row.getCell(4)))); assert.equal(t.deadline, d(val(row.getCell(5)))); assert.equal(t.hard_limit, d(val(row.getCell(6))));
      assert.equal(t.status, String(val(row.getCell(7)))); assert.equal(t.progress, Math.round(Number(val(row.getCell(8))) * 100));
      assert.equal(t.notes, String(val(row.getCell(13)) || '').trim());
      const shaded = row.getCell(2).fill && row.getCell(2).fill.fgColor && row.getCell(2).fill.fgColor.argb === 'FFFCE4D6';
      assert.equal(!!t.final4, !!shaded);
      checked++;
    });
    assert.equal(i, rows.length, dep);
  }
  assert.equal(checked, 222);
});

test('spot-check 5 rows by hand against the workbook', () => {
  const g = (dep, seq) => app.db.prepare("SELECT * FROM tasks WHERE country='Nigeria' AND department=? AND seq=? AND row_type='task'").get(dep, seq);
  const t1 = g('Office of the Founder', 1);
  assert.equal(t1.title, 'Confirm the eligibility gap list: legal status (CAC), U.S. status and accounts'); assert.equal(t1.owner, 'John (Founder)');
  assert.equal(t1.start_date, '2026-10-26'); assert.equal(t1.deadline, '2026-11-06'); assert.equal(t1.hard_limit, '2026-11-20'); assert.equal(t1.status, 'Not started');
  const t2 = g('Office of the Founder', 3); assert.equal(t2.deadline, '2026-11-20'); assert.equal(t2.hard_limit, '2026-12-04');
  const t3 = g('International & Diplomacy', 1); assert.equal(t3.owner, 'Abisade (Legal & Diplomacy Director)'); assert.equal(t3.deadline, '2026-11-20');
  const t4 = g('Technology', 1); assert.equal(t4.owner, 'To be appointed (Technology Lead)'); assert.equal(t4.deadline, '2026-11-13');
  const t5 = g('Technology', 2); assert.match(t5.title, /^Load this action plan into the Meeting R/); assert.equal(t5.start_date, '2026-11-02'); assert.equal(t5.deadline, '2026-12-11');
  assert.equal(app.db.prepare("SELECT status FROM tasks WHERE country='Nigeria' AND row_type='task' AND status<>'Not started'").all().length, 0);
});

test('formula date columns were imported as their saved values (EventDate-based dates)', () => {
  const t = app.db.prepare("SELECT deadline FROM tasks WHERE country='Nigeria' AND department='Programs & Competition' AND seq=1").get();
  assert.equal(t.deadline, '2027-06-30'); // EventDate (Nov 11, 2027) - 134 days
});

test('other countries start empty; Nigeria tabs show the 10 columns in order', async () => {
  for (const c of ['United States', 'Canada', 'United Arab Emirates', 'United Kingdom', 'Australia']) assert.equal(app.db.prepare('SELECT COUNT(*) c FROM tasks WHERE country=?').get(c).c, 0, c);
  const t = await us.c.get('/meeting-room/plan/united-states/all'); assert.equal(t.status, 200);
  assert.match(t.text, /No tasks have been added for this tab yet/);
  const n = (await ng.c.get('/meeting-room/plan/nigeria/technology')).text;
  const heads = [...n.match(/<thead><tr>(.*?)<\/tr><\/thead>/s)[1].matchAll(/<th>(.*?)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['No.', 'Task', 'Owner', 'Start', 'Deadline (planned finish)', 'Hard limit', 'Status', '% progress', 'Flag', 'Notes']);
  assert.match(n, /<tr class="phase"><td colspan="10">PHASE 1 - FOUNDATIONS/);
  assert.match(n, /class="final4"/); assert.match(n, /Final 4 weeks: review only/);
  assert.match(n, /PROPOSED: Nov 11, 2027 \(Thursday\)/);
  assert.equal([...n.matchAll(/<tr id="task-/g)].length, 24);
  const all = (await ng.c.get('/meeting-room/plan/nigeria/all')).text; assert.equal([...all.matchAll(/<tr id="task-/g)].length, 222);
  assert.match(all, /Overall summary by department/);
});

test('About this plan shows the Read me text and the PROPOSED line', async () => {
  const r = await ng.c.get('/meeting-room/plan/about');
  assert.match(r.text, /PROPOSED: Nov 11, 2027/); assert.match(r.text, /John&#39;s rule: everything is done EARLY|John's rule: everything is done EARLY/);
  assert.match(r.text, /Flag rule/); assert.match(r.text, /What John must supply/);
});

test('a US member cannot open the Nigeria plan, its tasks or its export, even by address', async () => {
  const nid = app.db.prepare("SELECT id FROM tasks WHERE country='Nigeria' AND row_type='task' LIMIT 1").get().id;
  for (const p of ['/meeting-room/plan/nigeria/all', '/meeting-room/plan/nigeria/technology', '/meeting-room/plan/nigeria/all/export.csv', '/meeting-room/plan/nigeria/technology/export.csv', '/meeting-room/task/' + nid]) assert.equal((await us.c.get(p)).status, 403, p);
  assert.equal((await us.c.post(`/meeting-room/task/${nid}/update`, { status: 'Done' })).status, 403);
  assert.equal((await ng.c.get('/meeting-room/plan/united-states/all')).status, 403, 'and the reverse');
  assert.equal((await us.c.get('/meeting-room/plan/global')).status, 403); assert.equal((await us.c.get('/meeting-room/plan/log')).status, 403);
  assert.equal((await us.c.get('/meeting-room/plan')).location, '/meeting-room/plan/united-states/all');
  assert.equal((await adm.john.get('/meeting-room/plan/nigeria/all')).status, 200); assert.equal((await adm.john.get('/meeting-room/plan/united-states/all')).status, 200);
});

test('owner updates own status and % only; others (members) cannot edit; admin edits everything; all changes are logged', async () => {
  const t = app.db.prepare("SELECT * FROM tasks WHERE country='Nigeria' AND department='Technology' AND seq=3 AND row_type='task'").get();
  // before linking: nobody but admin can edit
  assert.equal((await ng.c.post(`/meeting-room/task/${t.id}/update`, { status: 'Done', progress: '100' })).status, 403);
  // admin links the owner (and changes the task text too)
  let r = await adm.john.post(`/meeting-room/task/${t.id}/update`, { owner_user_id: String(ng.id), title: t.title + ' (edited)', deadline: '2026-12-30' });
  assert.equal(r.status, 302);
  const a = app.db.prepare('SELECT * FROM tasks WHERE id=?').get(t.id); assert.equal(a.owner_user_id, ng.id); assert.equal(a.title, t.title + ' (edited)'); assert.equal(a.deadline, '2026-12-30');
  // the owner updates status and progress
  r = await ng.c.post(`/meeting-room/task/${t.id}/update`, { status: 'In progress', progress: '40' });
  assert.equal(r.status, 302); const b = app.db.prepare('SELECT * FROM tasks WHERE id=?').get(t.id); assert.equal(b.status, 'In progress'); assert.equal(b.progress, 40);
  // the owner CANNOT change anything else (extra fields are ignored)
  await ng.c.post(`/meeting-room/task/${t.id}/update`, { status: 'In progress', progress: '45', title: 'HACKED', owner: 'me', deadline: '2030-01-01', notes: 'hacked', owner_user_id: String(ng2.id) });
  const c = app.db.prepare('SELECT * FROM tasks WHERE id=?').get(t.id);
  assert.equal(c.progress, 45); assert.equal(c.title, t.title + ' (edited)'); assert.equal(c.deadline, '2026-12-30'); assert.equal(c.owner, t.owner); assert.equal(c.notes, t.notes); assert.equal(c.owner_user_id, ng.id);
  // another member (same country and department) cannot change it
  assert.equal((await ng2.c.post(`/meeting-room/task/${t.id}/update`, { status: 'Done', progress: '100' })).status, 403);
  assert.equal(app.db.prepare('SELECT status FROM tasks WHERE id=?').get(t.id).status, 'In progress');
  // invalid values
  assert.equal((await ng.c.post(`/meeting-room/task/${t.id}/update`, { status: 'Finished-ish', progress: '45' })).status, 403);
  assert.equal((await ng.c.post(`/meeting-room/task/${t.id}/update`, { status: 'Done', progress: '140' })).status, 403);
  // members only view (no controls on tasks they do not own)
  const page = (await ng2.c.get('/meeting-room/plan/nigeria/technology')).text;
  assert.doesNotMatch(page, new RegExp(`id="u${t.id}"`)); assert.match((await ng.c.get('/meeting-room/plan/nigeria/technology')).text, new RegExp(`id="u${t.id}"`));
  // the change log: who, what, old, new, when
  const log = (await adm.abisade.get('/meeting-room/plan/log')).text;
  assert.match(log, /Ng Owner/); assert.match(log, /status: &#34;Not started&#34; -&gt; &#34;In progress&#34;/); assert.match(log, /progress: &#34;0&#34; -&gt; &#34;40&#34;/); assert.match(log, /John Adebowale/); assert.match(log, /deadline:/);
  assert.match(log, /Nigeria \/ Technology \/ #3/);
  const rows = app.db.prepare("SELECT * FROM audit_log WHERE kind='plan_edit'").all(); assert.ok(rows.length >= 6); assert.ok(rows.every((x) => x.created_at && x.actor_id));
  // members cannot read the change log
  assert.equal((await ng.c.get('/meeting-room/plan/log')).status, 403);
});

test('admins add and delete tasks; members cannot', async () => {
  const before = app.db.prepare("SELECT COUNT(*) c FROM tasks WHERE country='United States' AND row_type='task'").get().c;
  assert.equal((await us.c.post('/meeting-room/plan/united-states/technology/add', { title: 'Member task' })).status, 403);
  const r = await adm.john.post('/meeting-room/plan/united-states/technology/add', { title: 'US first task', owner: 'Test Owner', start_date: '2026-11-01', deadline: '2026-12-01', notes: '=HYPERLINK("x")' });
  assert.equal(r.status, 302);
  const t = app.db.prepare("SELECT * FROM tasks WHERE country='United States' AND title='US first task'").get();
  assert.equal(t.seq, 1); assert.equal(t.department, 'Technology'); assert.equal(app.db.prepare("SELECT COUNT(*) c FROM tasks WHERE country='United States' AND row_type='task'").get().c, before + 1);
  assert.equal((await us.c.post(`/meeting-room/task/${t.id}/delete`)).status, 403);
  assert.equal((await adm.john.post(`/meeting-room/task/${t.id}/delete`)).status, 302);
  assert.equal(app.db.prepare('SELECT 1 FROM tasks WHERE id=?').get(t.id), undefined);
  assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE kind='plan_add'").get()); assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE kind='plan_delete'").get());
});

test('CSV export: opens correctly (UTF-8 BOM, quoting, no formula injection), allowed scope only', async () => {
  const all = await ng.c.get('/meeting-room/plan/nigeria/all/export.csv');
  assert.equal(all.status, 200); assert.match(all.headers.get('content-type'), /text\/csv; charset=utf-8/); assert.match(all.headers.get('content-disposition'), /action-plan-nigeria-all-departments\.csv/);
  assert.equal(all.buf.slice(0, 3).toString('hex'), 'efbbbf', 'BOM so Excel reads UTF-8');
  const rows = parseCsv(all.text.replace(/^\uFEFF/, ''));
  assert.equal(rows.length, 223); // header + 222
  assert.deepEqual(rows[0], ['Department', 'No.', 'Task', 'Owner', 'Start', 'Deadline (planned finish)', 'Hard limit', 'Status', '% progress', 'Flag', 'Final 4 weeks', 'Notes']);
  assert.ok(rows.every((r) => r.length === 12), 'every row has 12 cells (commas and quotes survived)');
  const tech = parseCsv((await ng.c.get('/meeting-room/plan/nigeria/technology/export.csv')).text.replace(/^\uFEFF/, '')); assert.equal(tech.length, 25);
  assert.ok(tech.slice(1).every((r) => r[0] === 'Technology'));
  const first = rows.find((r) => r[0] === 'Office of the Founder' && r[1] === '1');
  assert.equal(first[2], 'Confirm the eligibility gap list: legal status (CAC), U.S. status and accounts'); assert.equal(first[4], '2026-10-26');
  // formula injection guard
  await adm.john.post('/meeting-room/plan/united-states/technology/add', { title: '=cmd|calc', owner: '+x', notes: '@y' });
  const us1 = parseCsv((await us.c.get('/meeting-room/plan/united-states/all/export.csv')).text.replace(/^\uFEFF/, ''));
  assert.equal(us1.length, 2); assert.equal(us1[1][2], "'=cmd|calc"); assert.equal(us1[1][3], "'+x"); assert.equal(us1[1][11], "'@y");
  // scope: Nigerian member cannot export US; US member only gets US
  assert.equal((await ng.c.get('/meeting-room/plan/united-states/all/export.csv')).status, 403);
  assert.equal((await adm.john.get('/meeting-room/plan/global.csv')).status, 200); assert.equal((await us.c.get('/meeting-room/plan/global.csv')).status, 403);
});

function parseCsv(s) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
