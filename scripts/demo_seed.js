'use strict';
/**
 * DEMO DATA ONLY. Fills a separate demo folder with clearly FAKE people so screenshots and manual
 * testing are possible. It refuses to run in production or anywhere except a folder named "demo-data".
 *
 *   DATA_DIR=./demo-data node scripts/demo_seed.js
 *
 * Everything here is fake: names start with "Test", e-mails end in @example.test, photos say TEST,
 * and the answer key comes from test/fixtures/fake_key.json (NOT the real key).
 */
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const { loadConfig, DEPARTMENTS } = require('../src/config');
const { createApp } = require('../src/app');
const { now, nextVolunteerId, audit, setSetting } = require('../src/db');
const sec = require('../src/security');
const FAKE = require('../test/fixtures/fake_key.json').key;

const PASSWORD = 'Demo-Password-123';
const ADMIN_PASSWORD = 'Demo-Admin-Password-1';

(async () => {
  const config = loadConfig();
  if (config.production || path.basename(config.dataDir) !== 'demo-data') { console.error('Refusing: demo data may only go into a folder named demo-data (and never in production).'); process.exit(1); }
  const { db, ctx, close } = await createApp({ ...config, quiet: true });
  if (db.prepare("SELECT COUNT(*) c FROM users WHERE email LIKE '%@example.test'").get().c) { console.log('Demo data already present.'); close(); return; }
  const hash = (pw) => sec.hashPassword(pw, config);

  // fake key + admins (demo passwords)
  const ukey = db.prepare('UPDATE questions SET answer_key=? WHERE num=?');
  Object.entries(FAKE).forEach(([n, l]) => ukey.run(l, Number(n)));
  for (const email of config.adminEmails) { db.prepare('UPDATE users SET pw_hash=? WHERE email=?').run(await hash(ADMIN_PASSWORD), email); db.prepare('UPDATE claim_codes SET used_at=? WHERE user_id=(SELECT id FROM users WHERE email=?)').run(now(), email); }
  fs.rmSync(path.join(config.dataDir, 'ADMIN_CLAIM_CODES.txt'), { force: true });
  const admin = db.prepare("SELECT id FROM users WHERE email='interschoolmusic@gmail.com'").get().id;

  const colors = ['#1d4d8f', '#7a5c10', '#2e6b4f', '#7d2a3c', '#4a3a8a', '#375b6e'];
  let ci = 0;
  async function person(o) {
    const file = require('crypto').randomBytes(8).toString('hex') + '.jpg';
    const initials = o.name.replace('Test ', '').split(' ').map((w) => w[0]).join('');
    const svg = `<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="600" fill="${colors[ci++ % colors.length]}"/><circle cx="300" cy="230" r="110" fill="#e8d8b0"/><rect x="130" y="360" width="340" height="260" rx="120" fill="#e8d8b0"/><text x="300" y="545" font-size="64" text-anchor="middle" fill="#fff" font-family="DejaVu Sans" font-weight="bold">TEST ${initials}</text></svg>`;
    fs.writeFileSync(path.join(config.dataDir, 'photos', file), await sharp(Buffer.from(svg)).jpeg().toBuffer());
    const r = db.prepare(`INSERT INTO users(email,name,phone,pw_hash,role,status,country_chosen,country,department,photo_file,age_confirmed,created_at)
      VALUES (?,?,?,?, 'volunteer', ?, ?, ?, ?, ?, 1, ?)`).run(o.email, o.name, '+1 555 0100', await hash(PASSWORD), o.status, o.chosen, o.country || null, o.dept || null, file, now());
    const id = Number(r.lastInsertRowid);
    if (o.score !== undefined) db.prepare('INSERT INTO attempts(user_id,answers,score,child_correct,result,passed,created_at) VALUES (?,?,?,?,?,?,?)').run(id, '{}', o.score, o.child, o.score >= 40 && o.child >= 9 ? 'pass' : 'fail', o.score >= 40 && o.child >= 9 ? 1 : 0, new Date(Date.now() - (o.ago || 3600) * 1000).toISOString());
    if (o.status === 'approved') {
      const vid = nextVolunteerId(db);
      const issued = new Date(Date.now() - 20 * 86400e3); const exp = new Date(issued); exp.setUTCFullYear(exp.getUTCFullYear() + 1);
      db.prepare("UPDATE users SET volunteer_id=?, id_issued_at=?, id_expires_at=?, id_status='active', approved_by=? WHERE id=?").run(vid, issued.toISOString(), exp.toISOString(), admin, id);
      audit(db, 'approve', admin, o.email, `${vid}; country ${o.country}; department ${o.dept} (demo)`);
    }
    return id;
  }
  const u = {};
  u.us1 = await person({ name: 'Test Ada Brooks', email: 'ada.us@example.test', status: 'approved', chosen: 'United States', country: 'United States', dept: 'Technology', score: 46, child: 10, ago: 86400 * 20 });
  u.us2 = await person({ name: 'Test Ben Carter', email: 'ben.us@example.test', status: 'approved', chosen: 'United States', country: 'United States', dept: 'Media & Communications', score: 44, child: 9, ago: 86400 * 19 });
  u.ng1 = await person({ name: 'Test Chioma Eze', email: 'chioma.ng@example.test', status: 'approved', chosen: 'Nigeria', country: 'Nigeria', dept: 'Technology', score: 47, child: 10, ago: 86400 * 21 });
  u.ng2 = await person({ name: 'Test Tunde Bello', email: 'tunde.ng@example.test', status: 'approved', chosen: 'Nigeria', country: 'Nigeria', dept: 'Technology', score: 42, child: 9, ago: 86400 * 21 });
  u.ng3 = await person({ name: 'Test Ngozi Obi', email: 'ngozi.ng@example.test', status: 'approved', chosen: 'Nigeria', country: 'Nigeria', dept: 'Child Welfare & Safeguarding', score: 49, child: 10, ago: 86400 * 18 });
  u.ca1 = await person({ name: 'Test Dana Lee', email: 'dana.ca@example.test', status: 'approved', chosen: 'Canada', country: 'Canada', dept: 'Technology', score: 45, child: 10, ago: 86400 * 17 });
  u.w1 = await person({ name: 'Test Ella Mensah', email: 'ella.wait@example.test', status: 'waiting', chosen: 'United Kingdom', score: 43, child: 9, ago: 7200 });
  u.w2 = await person({ name: 'Test Femi Adeyemi', email: 'femi.wait@example.test', status: 'waiting', chosen: 'United States', score: 48, child: 10, ago: 3600 * 30 });
  u.w3 = await person({ name: 'Test Grace Wong', email: 'grace.wait@example.test', status: 'waiting', chosen: 'Australia', score: 41, child: 10, ago: 600 });
  u.ap = await person({ name: 'Test Hana Ibrahim', email: 'hana.app@example.test', status: 'applicant', chosen: 'United Arab Emirates', score: 31, child: 6, ago: 5000 });
  u.in = await person({ name: 'Test Ian Novak', email: 'ian.interest@example.test', status: 'interest', chosen: "My country isn't listed" });

  // chat
  const msg = db.prepare('INSERT INTO messages(room,user_id,body,created_at) VALUES (?,?,?,?)');
  const t = (m) => new Date(Date.now() - m * 60000).toISOString();
  msg.run('general', admin, 'Welcome to the NISMCAA Meeting Room. (TEST message)', t(240));
  msg.run('general', u.us1, 'Hello from the United States team! (TEST)', t(200));
  msg.run('general', u.ng1, 'Hello from Nigeria. (TEST)', t(150));
  msg.run('c:Nigeria', u.ng1, 'Technology team: please update your task status this week. (TEST)', t(90));
  msg.run('c:Nigeria', u.ng2, 'Done. I updated mine. (TEST)', t(60));
  msg.run('c:United States', u.us1, 'US team call on Thursday at 7 pm Eastern. (TEST)', t(30));
  // notes
  const note = db.prepare('INSERT INTO notes(user_id,country,title,note_date,body,visibility,created_at) VALUES (?,?,?,?,?,?,?)');
  note.run(u.ng1, 'Nigeria', 'Technology weekly call', '2026-10-26', 'TEST NOTE: agreed to load the action plan and check the flags every Monday.', 'country', now());
  note.run(u.ng1, 'Nigeria', 'My private reminders', '2026-10-26', 'TEST NOTE: private.', 'private', now());
  // settings + heads + plan progress
  setSetting(db, 'call_link_main', 'https://meet.jit.si/NISMCAA-TEST-ROOM');
  db.prepare('UPDATE heads SET user_id=?, assigned_at=? WHERE country=? AND department=?').run(u.ng1, now(), 'Nigeria', 'Technology');
  const techTasks = db.prepare("SELECT id, seq FROM tasks WHERE country='Nigeria' AND department='Technology' AND row_type='task' ORDER BY sort LIMIT 6").all();
  db.prepare("UPDATE tasks SET owner_user_id=?, status='In progress', progress=40 WHERE id=?").run(u.ng2, techTasks[0].id);
  db.prepare("UPDATE tasks SET owner_user_id=?, status='Done', progress=100 WHERE id=?").run(u.ng1, techTasks[1].id);
  db.prepare("UPDATE tasks SET owner_user_id=? WHERE id=?").run(u.ng2, techTasks[2].id);
  db.prepare('INSERT INTO worklog(task_id,user_id,entry_date,body,created_at) VALUES (?,?,?,?,?)').run(techTasks[0].id, u.ng2, '2026-10-27', 'TEST ENTRY: checked the DNS settings and wrote down what is missing.', now());
  db.prepare('INSERT INTO remarks(country,department,member_id,author_id,body,created_at) VALUES (?,?,?,?,?,?)').run('Nigeria', 'Technology', u.ng2, u.ng1, 'TEST REMARK: reliable and on time this month.', now());
  // a small FAKE Canada plan, so all flag colors are visible
  const ins = db.prepare(`INSERT INTO tasks(country,department,row_type,seq,title,owner,owner_user_id,start_date,deadline,hard_limit,status,progress,notes,sort) VALUES ('Canada','Technology','task',?,?,?,?,?,?,?,?,?,?,?)`);
  const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
  ins.run(1, 'TEST TASK: past its deadline, not done', 'Test Dana Lee', u.ca1, day(-30), day(-3), day(11), 'In progress', 60, 'Demo row (red: deadline passed)', 1);
  ins.run(2, 'TEST TASK: about 20 points behind', 'Test Dana Lee', u.ca1, day(-10), day(10), day(24), 'In progress', 30, 'Demo row (amber)', 2);
  ins.run(3, 'TEST TASK: 35 points behind', 'To be appointed', null, day(-10), day(10), day(24), 'In progress', 15, 'Demo row (red: 30+ behind)', 3);
  ins.run(4, 'TEST TASK: finished', 'Test Dana Lee', u.ca1, day(-20), day(-5), day(9), 'Done', 100, 'Demo row (green)', 4);
  ins.run(5, 'TEST TASK: on hold', 'To be appointed', null, day(-20), day(20), day(34), 'On hold', 0, 'Demo row (not flagged)', 5);
  ins.run(6, 'TEST TASK: no deadline set', 'To be appointed', null, null, null, null, 'Not started', 0, 'Demo row (not flagged)', 6);
  audit(db, 'demo_seed', admin, 'demo', 'fake demo data loaded');
  console.log('Demo data loaded into', config.dataDir);
  console.log(`Admin sign-in (demo only): interschoolmusic@gmail.com / ${ADMIN_PASSWORD}`);
  console.log(`Fake volunteers (demo only): e.g. ada.us@example.test / ${PASSWORD}`);
  close();
})().catch((e) => { console.error(e); process.exit(1); });
