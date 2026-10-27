'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { flagFor, summarize } = require('../src/plan');

const T = (o) => ({ row_type: 'task', status: 'In progress', progress: 0, start_date: '2027-01-01', deadline: '2027-01-11', ...o });

test('flag rules (unit): deadline passed = red; 20 behind = amber; 35 behind = red; done = green; no deadline = grey; on hold = grey', () => {
  const today = '2027-01-06'; // 5 of 10 days used = 50%
  assert.equal(flagFor(T({ progress: 30 }), today).points, 20);
  assert.equal(flagFor(T({ progress: 30 }), today).flag, 'amber', '20 points behind');
  assert.equal(flagFor(T({ progress: 15 }), today).points, 35);
  assert.equal(flagFor(T({ progress: 15 }), today).flag, 'red', '35 points behind');
  assert.equal(flagFor(T({ progress: 50 }), today).flag, 'green', 'on pace');
  assert.equal(flagFor(T({ progress: 90 }), today).flag, 'green', 'ahead');
  assert.equal(flagFor(T({ progress: 0 }), '2027-01-12').flag, 'red', 'deadline passed and not done');
  assert.equal(flagFor(T({ progress: 100, status: 'In progress' }), '2027-01-12').flag, 'red', 'past deadline: only Done counts');
  assert.equal(flagFor(T({ status: 'Done', progress: 100 }), '2027-01-12').flag, 'green', 'done task is green even after its deadline');
  assert.equal(flagFor(T({ status: 'Done', progress: 0 }), today).flag, 'green');
  assert.equal(flagFor(T({ deadline: null }), today).flag, 'grey', 'no deadline');
  assert.equal(flagFor(T({ start_date: null }), today).flag, 'grey', 'no start (same as the workbook)');
  assert.equal(flagFor(T({ status: 'On hold', progress: 0 }), '2027-03-01').flag, 'grey', 'on hold');
  // exact boundaries
  assert.equal(flagFor(T({ progress: 36 }), today).flag, 'green');  // 14 behind
  assert.equal(flagFor(T({ progress: 35 }), today).flag, 'amber');  // 15 behind
  assert.equal(flagFor(T({ progress: 21 }), today).flag, 'amber');  // 29 behind
  assert.equal(flagFor(T({ progress: 20 }), today).flag, 'red');    // 30 behind
  // deadline day itself is not "passed" yet; time used is capped at 100%
  assert.equal(flagFor(T({ progress: 100, status: 'Blocked' }), '2027-01-11').flag, 'green');
  assert.equal(flagFor(T({ progress: 60, status: 'Blocked' }), '2027-01-11').flag, 'red', '40 behind on the last day');
  // not started yet: time used 0
  assert.equal(flagFor(T({ progress: 0 }), '2026-12-01').flag, 'green');
  assert.equal(flagFor(T({ progress: 0 }), '2026-12-01').points, 0);
  assert.equal(flagFor(T({ progress: 50 }), today).label, 'Green');
});

test('summary counts and owners behind', () => {
  const rows = [T({ progress: 30, owner: 'Ann' }), T({ progress: 15, owner: 'Bob' }), T({ progress: 50, owner: 'Cy' }), T({ status: 'Done', owner: 'Di' }), T({ deadline: null, owner: 'Ed' }), T({ status: 'On hold', owner: 'Flo' }), { row_type: 'phase', title: 'x' }];
  const s = summarize(rows, '2027-01-06');
  assert.deepEqual({ total: s.total, done: s.done, red: s.red, amber: s.amber, green: s.green, grey: s.grey }, { total: 6, done: 1, red: 1, amber: 1, green: 2, grey: 2 });
  assert.deepEqual(s.owners, ['Ann', 'Bob']);
});

let app, adm, techA, techB, finance, other;
const seatRows = () => app.db.prepare('SELECT * FROM heads').all();
before(async () => {
  app = await H.startApp({ today: '2027-01-06' }); app.setFakeKey(); adm = await H.admins(app);
  techA = await H.approvedVolunteer(app, adm, { name: 'Tech Alpha', country: 'Canada', dept: 'Technology' });
  techB = await H.approvedVolunteer(app, adm, { name: 'Tech Bravo', country: 'Canada', dept: 'Technology' });
  finance = await H.approvedVolunteer(app, adm, { name: 'Fin Charlie', country: 'Canada', dept: 'Finance & Admin' });
  other = await H.approvedVolunteer(app, adm, { name: 'Aus Delta', country: 'Australia', dept: 'Technology' });
  // five Canada Technology tasks with known flags (today is 2027-01-06)
  const ins = app.db.prepare(`INSERT INTO tasks(country,department,row_type,seq,title,owner,owner_user_id,start_date,deadline,status,progress,sort) VALUES ('Canada','Technology','task',?,?,?,?,?,?,?,?,?)`);
  ins.run(1, 'T-RED-PAST', 'Alpha Owner', techA.id, '2026-12-01', '2027-01-02', 'In progress', 90, 1);
  ins.run(2, 'T-AMBER', 'Bravo Owner', techB.id, '2027-01-01', '2027-01-11', 'In progress', 30, 2);
  ins.run(3, 'T-RED-35', 'Alpha Owner', techA.id, '2027-01-01', '2027-01-11', 'In progress', 15, 3);
  ins.run(4, 'T-DONE', 'Zed', null, '2026-12-01', '2027-01-02', 'Done', 100, 4);
  ins.run(5, 'T-NODEADLINE', 'Zed', null, '2027-01-01', null, 'Not started', 0, 5);
  ins.run(6, 'T-HOLD', 'Zed', null, '2026-12-01', '2027-01-02', 'On hold', 0, 6);
  app.db.prepare(`INSERT INTO tasks(country,department,row_type,seq,title,owner,owner_user_id,start_date,deadline,status,progress,sort) VALUES ('Canada','Finance & Admin','task',1,'F-GREEN','Fin Owner',?,'2027-01-01','2027-01-11','In progress',60,1)`).run(finance.id);
});
after(async () => { await app.close(); });
const dbTask = (title) => app.db.prepare('SELECT id FROM tasks WHERE title=?').get(title).id;

test('flags show on the tab as a coloured dot plus the word, per task', async () => {
  const page = (await techA.c.get('/meeting-room/plan/canada/technology')).text;
  const row = (t) => page.match(new RegExp(`<tr id="task-${dbTask(t)}".*?</tr>`, 's'))[0];
  assert.match(row('T-RED-PAST'), /<span class="dot red"><\/span><span class="flagword red">Red<\/span>/);
  assert.match(row('T-AMBER'), /dot amber"><\/span><span class="flagword amber">Amber/);
  assert.match(row('T-RED-35'), /flagword red">Red/);
  assert.match(row('T-DONE'), /dot green"><\/span><span class="flagword green">Green/);
  assert.match(row('T-NODEADLINE'), /dot grey"><\/span><span class="flagword grey">Not flagged/);
  assert.match(row('T-HOLD'), /flagword grey">Not flagged/);
});

test('"Behind schedule" box: right counts and owner names; all-departments summary; admin global totals', async () => {
  const tab = (await techB.c.get('/meeting-room/plan/canada/technology')).text;
  const box = tab.match(/<div class="behind[^"]*" id="behind-box">(.*?)<\/div>/s)[1];
  assert.match(box, /2 red/); assert.match(box, /1 amber/); assert.match(box, /Owners behind: <strong>Tech Alpha, Tech Bravo<\/strong>/); assert.match(box, /6 tasks, 1 done, 1 green, 2 not flagged/);
  const fin = (await finance.c.get('/meeting-room/plan/canada/finance-and-admin')).text.match(/id="behind-box">(.*?)<\/div>/s)[1];
  assert.match(fin, /nothing behind schedule/);
  const all = (await techA.c.get('/meeting-room/plan/canada/all')).text;
  assert.match(all.match(/id="behind-box">(.*?)<\/div>/s)[1], /2 red/); assert.match(all, /Overall summary by department/);
  assert.match(all, /<td><a href="\/meeting-room\/plan\/canada\/technology">Technology<\/a><\/td><td>6<\/td><td>1<\/td><td>2<\/td><td>1<\/td><td>Tech Alpha, Tech Bravo<\/td>/);
  const g = (await adm.john.get('/meeting-room/plan/global')).text;
  assert.match(g, /<td><a href="\/meeting-room\/plan\/canada\/all">Canada<\/a><\/td><td>7<\/td><td>1<\/td><td>2<\/td><td>1<\/td><td>2<\/td><td>2<\/td>/);
  assert.match(g, /<td><a href="\/meeting-room\/plan\/australia\/all">Australia<\/a><\/td><td>0<\/td>/);
  assert.match(g, /<th>Total<\/th><th>229<\/th><th>1<\/th>/);
  assert.equal((await techA.c.get('/meeting-room/plan/global')).status, 403);
  assert.equal((await other.c.get('/meeting-room/plan/canada/all')).status, 403);
});

test('Head seats: all 60 start EMPTY; only an admin can assign; head must be an approved, passed volunteer of that country', async () => {
  const seats = seatRows();
  assert.equal(seats.length, 60); assert.ok(seats.every((s) => s.user_id === null));
  assert.equal(new Set(seats.map((s) => s.country)).size, 6); assert.equal(new Set(seats.map((s) => s.department)).size, 10);
  // volunteers and signed-out cannot assign
  assert.equal((await techA.c.post('/admin/heads', { country: 'Canada', department: 'Technology', user_id: String(techA.id) })).status, 403);
  assert.equal((await app.client().post('/admin/heads', { country: 'Canada', department: 'Technology', user_id: String(techA.id) })).status, 302);
  assert.ok(seatRows().every((s) => s.user_id === null));
  assert.match((await techA.c.get('/meeting-room/plan/canada/technology')).text, /Empty\. The administrators act as head/);
  // wrong country / not approved
  await adm.john.post('/admin/heads', { country: 'Canada', department: 'Technology', user_id: String(other.id) });
  const w = await H.waitingVolunteer(app, { country: 'Canada' });
  await adm.john.post('/admin/heads', { country: 'Canada', department: 'Technology', user_id: String(w.id) });
  assert.ok(seatRows().every((s) => s.user_id === null), 'not assigned');
  // admin assigns, replaces, removes
  await adm.john.post('/admin/heads', { country: 'Canada', department: 'Technology', user_id: String(techA.id) });
  assert.equal(app.db.prepare("SELECT user_id FROM heads WHERE country='Canada' AND department='Technology'").get().user_id, techA.id);
  assert.match((await techB.c.get('/meeting-room/plan/canada/technology')).text, /Head seat:<\/strong> Tech Alpha/);
  await adm.abisade.post('/admin/heads', { country: 'Canada', department: 'Technology', user_id: String(techB.id) });
  assert.equal(app.db.prepare("SELECT user_id FROM heads WHERE country='Canada' AND department='Technology'").get().user_id, techB.id);
  await adm.abisade.post('/admin/heads', { country: 'Canada', department: 'Technology', user_id: '' });
  assert.equal(app.db.prepare("SELECT user_id FROM heads WHERE country='Canada' AND department='Technology'").get().user_id, null);
  assert.equal(seatRows().length, 60, 'no department is ever missing');
  assert.ok(app.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE kind IN ('head_assigned','head_removed')").get().c >= 3);
});

test('work log: members of the department add entries with their name; nobody edits or deletes another person\'s entry', async () => {
  const tid = dbTask('T-AMBER');
  assert.equal((await finance.c.post(`/meeting-room/task/${tid}/log`, { body: 'finance person trying' })).status, 403, 'not a member of Technology');
  assert.equal((await techA.c.post(`/meeting-room/task/${tid}/log`, { body: 'ALPHA-LOG-ENTRY', entry_date: '2027-01-05' })).status, 302);
  assert.equal((await techB.c.post(`/meeting-room/task/${tid}/log`, { body: 'BRAVO-LOG-ENTRY' })).status, 302);
  const e = app.db.prepare("SELECT * FROM worklog WHERE body='ALPHA-LOG-ENTRY'").get();
  assert.equal(e.user_id, techA.id); assert.equal(e.entry_date, '2027-01-05');
  // edit/delete someone else's: refused and unchanged
  assert.equal((await techB.c.post(`/meeting-room/log/${e.id}/edit`, { body: 'HACKED' })).status, 403);
  assert.equal((await techB.c.post(`/meeting-room/log/${e.id}/delete`)).status, 403);
  assert.equal((await adm.john.post(`/meeting-room/log/${e.id}/edit`, { body: 'ADMIN-EDIT' })).status, 403, 'even admins do not rewrite members\' entries');
  assert.equal(app.db.prepare('SELECT body FROM worklog WHERE id=?').get(e.id).body, 'ALPHA-LOG-ENTRY');
  // own entry: edit and delete work
  await techA.c.post(`/meeting-room/log/${e.id}/edit`, { body: 'ALPHA-EDITED' }); assert.equal(app.db.prepare('SELECT body FROM worklog WHERE id=?').get(e.id).body, 'ALPHA-EDITED');
  // visibility: a member sees their own entries; admin sees all
  const bSees = (await techB.c.get('/meeting-room/task/' + tid)).text; assert.match(bSees, /BRAVO-LOG-ENTRY/); assert.doesNotMatch(bSees, /ALPHA-EDITED/);
  const adminSees = (await adm.john.get('/meeting-room/task/' + tid)).text; assert.match(adminSees, /BRAVO-LOG-ENTRY/); assert.match(adminSees, /ALPHA-EDITED/);
  await techA.c.post(`/meeting-room/log/${e.id}/delete`); assert.equal(app.db.prepare('SELECT 1 FROM worklog WHERE id=?').get(e.id), undefined);
});

test('head remarks: head or admin write; a member sees only their own; head sees the whole department; members with no remark are listed', async () => {
  await adm.john.post('/admin/heads', { country: 'Canada', department: 'Technology', user_id: String(techA.id) }); // Alpha is head of Technology
  const tabPath = '/meeting-room/plan/canada/technology';
  // Alpha (head) sees the "no remark yet" list with both members
  let t = (await techA.c.get(tabPath)).text; assert.match(t, /Members with no remark yet:<\/strong> Tech Alpha, Tech Bravo/);
  assert.equal((await techA.c.post(tabPath + '/remark', { member_id: String(techB.id), body: 'REMARK-ABOUT-BRAVO' })).status, 302);
  assert.equal((await adm.john.post(tabPath + '/remark', { member_id: String(techA.id), body: 'REMARK-ABOUT-ALPHA' })).status, 302);
  t = (await techA.c.get(tabPath)).text; assert.match(t, /REMARK-ABOUT-BRAVO/); assert.match(t, /REMARK-ABOUT-ALPHA/); assert.match(t, /Every member has at least one remark/);
  // Bravo sees only the remark about himself
  const b = (await techB.c.get(tabPath)).text; assert.match(b, /REMARK-ABOUT-BRAVO/); assert.doesNotMatch(b, /REMARK-ABOUT-ALPHA/); assert.doesNotMatch(b, /Members with no remark yet/);
  // a member cannot write remarks; nor a head of another department; remarks cannot target another department's member
  assert.equal((await techB.c.post(tabPath + '/remark', { member_id: String(techA.id), body: 'BRAVO-WRITES' })).status, 403);
  assert.equal((await finance.c.post(tabPath + '/remark', { member_id: String(techA.id), body: 'x' })).status, 403);
  assert.equal(app.db.prepare("SELECT COUNT(*) c FROM remarks WHERE body IN ('BRAVO-WRITES','x')").get().c, 0);
  // member page: self, head, admin only
  assert.equal((await techB.c.get('/meeting-room/member/' + techB.id)).status, 200);
  assert.match((await techB.c.get('/meeting-room/member/' + techB.id)).text, /REMARK-ABOUT-BRAVO/);
  assert.equal((await techB.c.get('/meeting-room/member/' + techA.id)).status, 403, 'a member cannot see another member\'s remarks');
  assert.equal((await finance.c.get('/meeting-room/member/' + techB.id)).status, 403);
  assert.equal((await other.c.get('/meeting-room/member/' + techB.id)).status, 403);
  assert.equal((await techA.c.get('/meeting-room/member/' + techB.id)).status, 200, 'head sees the department');
  assert.equal((await techA.c.get('/meeting-room/member/' + finance.id)).status, 403, 'head does not see other departments');
  assert.equal((await adm.abisade.get('/meeting-room/member/' + finance.id)).status, 200);
  // head can also read all work log entries of the department's tasks
  const tid = dbTask('T-RED-35'); await techB.c.post(`/meeting-room/task/${tid}/log`, { body: 'BRAVO-WORK' });
  assert.match((await techA.c.get('/meeting-room/task/' + tid)).text, /BRAVO-WORK/);
  assert.match((await techA.c.get('/meeting-room/member/' + techB.id)).text, /BRAVO-WORK/);
  // another department: empty seat means admins act as head
  assert.match((await finance.c.get('/meeting-room/plan/canada/finance-and-admin')).text, /Empty\. The administrators act as head/);
  assert.equal((await adm.john.get('/meeting-room/plan/canada/finance-and-admin')).status, 200);
  assert.match((await adm.john.get('/meeting-room/plan/canada/finance-and-admin')).text, /Members with no remark yet:<\/strong> Fin Charlie/);
});
