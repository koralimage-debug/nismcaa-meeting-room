'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const H = require('./helpers');
const { loadCourse, words } = require('../src/content');
const { grade } = require('../src/routes/course');

let app, adm;
before(async () => { app = await H.startApp(); adm = await H.admins(app); });
after(async () => { await app.close(); });

const status = (email) => app.db.prepare('SELECT status FROM users WHERE email=?').get(email).status;
const pendingRows = () => app.db.prepare("SELECT COUNT(*) c FROM users WHERE status='waiting'").get().c;

test('the production seed has 50 questions and an EMPTY answer key', () => {
  const rows = app.db.prepare('SELECT * FROM questions ORDER BY num').all();
  assert.equal(rows.length, 50);
  assert.ok(rows.every((r) => r.answer_key === ''), 'answer_key is empty for every question');
  assert.equal(rows.filter((r) => r.child_protection).length, 10);
  assert.deepEqual(rows.filter((r) => r.child_protection).map((r) => r.num), [41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'db.js'), 'utf8');
  assert.ok(!/fake_key|FAKE/i.test(src), 'no test key referenced from the production seed');
});

test('questions in the database match COURSE_TEXT.txt exactly (50, with 3 or 4 options)', () => {
  const course = loadCourse(app.config.courseFile);
  const rows = app.db.prepare('SELECT * FROM questions ORDER BY num').all();
  rows.forEach((r, i) => {
    const q = course.questions[i];
    assert.equal(r.text, q.text); assert.deepEqual(JSON.parse(r.options), q.options);
    assert.equal(JSON.parse(r.options).length, r.num > 40 ? 4 : 3, 'Q' + r.num);
  });
  const raw = fs.readFileSync(app.config.courseFile, 'utf8');
  assert.match(raw, /1\. What does NISMCAA combine\?/); assert.equal(rows[0].text, 'What does NISMCAA combine?');
});

test('with NO answer key: results are "pending key", nobody can pass', async () => {
  const c = app.client();
  await H.signUp(c, { email: 'nokey@example.test' });
  const r = await H.takeTest(c, 40, 10);          // a perfect paper
  assert.equal(r.status, 302); assert.equal(r.location, '/course/test/result');
  const page = await c.get('/course/test/result');
  assert.match(page.text, /Result pending key/);
  assert.doesNotMatch(page.text, /You passed/);
  assert.equal(status('nokey@example.test'), 'applicant');
  const a = app.db.prepare('SELECT * FROM attempts ORDER BY id DESC LIMIT 1').get();
  assert.equal(a.result, 'pending'); assert.equal(a.passed, 0); assert.equal(a.score, null);
  assert.equal(pendingRows(), 0);
  assert.equal(grade(app.db, { 1: 'A' }).result, 'pending');
});

test('a PARTIAL key (49 of 50) is still "pending"', async () => {
  const u = app.db.prepare('UPDATE questions SET answer_key=? WHERE num=?');
  for (const [n, l] of Object.entries(H.FAKE)) if (n !== '50') u.run(l, Number(n));
  assert.equal(grade(app.db, {}).result, 'pending');
  const c = app.client(); await H.signUp(c, { email: 'partialkey@example.test' });
  await H.takeTest(c, 40, 10);
  assert.equal(status('partialkey@example.test'), 'applicant');
  app.db.prepare("UPDATE questions SET answer_key='' ").run();
});

test('admin can enter the key through the admin page, then saved attempts are graded', async () => {
  // the earlier "nokey" attempt is saved as pending
  assert.ok(app.db.prepare("SELECT COUNT(*) c FROM attempts WHERE result='pending'").get().c >= 1);
  // validation: letter that does not exist for a question is rejected
  let r = await adm.john.post('/admin/key', { key: '1:E\n41:D' });
  assert.equal(r.status, 302);
  assert.equal(app.db.prepare('SELECT answer_key FROM questions WHERE num=1').get().answer_key, '');
  assert.equal(app.db.prepare('SELECT answer_key FROM questions WHERE num=41').get().answer_key, 'D');
  assert.equal((await adm.john.post('/admin/key/regrade')).status, 302);
  assert.equal(status('nokey@example.test'), 'applicant', 'regrade refused while the key is incomplete');
  // enter the (FAKE, test-only) key in the textarea format
  const text = Object.entries(H.FAKE).map(([n, l]) => `${n}:${l}`).join('\n');
  r = await adm.john.post('/admin/key', { key: text }); assert.equal(r.status, 302);
  assert.equal(app.db.prepare("SELECT COUNT(*) c FROM questions WHERE answer_key<>''").get().c, 50);
  const keyPage = await adm.john.get('/admin/key'); assert.match(keyPage.text, /key is complete/);
  await adm.john.post('/admin/key/regrade');
  assert.equal(status('nokey@example.test'), 'waiting', 'the perfect paper saved earlier is now graded and passed');
});

test('PASS RULE: 80% overall AND at least 9 of 10 child protection', async () => {
  const cases = [
    // [general correct of 40, child correct of 10, expect pass]
    [40, 10, true], [31, 9, true], [30, 10, true], [29, 10, false], [30, 9, false],
    [40, 8, false], [40, 0, false], [0, 10, false], [39, 9, true], [32, 8, false],
  ];
  for (const [g, ch, pass] of cases) {
    const res = grade(app.db, Object.fromEntries(Object.entries(H.answers(g, ch)).map(([k, v]) => [Number(k.slice(1)), v])));
    assert.equal(res.score, g + ch, `${g}+${ch}`);
    assert.equal(!!res.passed, pass, `general ${g}, child ${ch}: score ${res.score}`);
  }
  // exactly the boundary: 40/50 with child 9 passes, 39/50 with child 10 fails
  assert.equal(grade(app.db, Object.fromEntries(Object.entries(H.answers(31, 9)).map(([k, v]) => [Number(k.slice(1)), v]))).passed, 1);
  assert.equal(grade(app.db, Object.fromEntries(Object.entries(H.answers(29, 10)).map(([k, v]) => [Number(k.slice(1)), v]))).passed, 0);
});

test('below 80% gives no pending entry and allows a retake; 80%+ gives one; every attempt is saved', async () => {
  const before = pendingRows();
  const c = app.client(); await H.signUp(c, { email: 'retake@example.test', name: 'Retake Person' });
  let r = await H.takeTest(c, 20, 5);             // 25/50
  assert.equal(r.location, '/course/test/result');
  let page = await c.get('/course/test/result');
  assert.match(page.text, /Not yet passed/); assert.match(page.text, /can retake/); assert.match(page.text, /25 of 50/);
  assert.doesNotMatch(page.text, /wrong answers:/i);
  assert.equal(status('retake@example.test'), 'applicant'); assert.equal(pendingRows(), before);
  // child protection fails the rule even with a high total
  await H.takeTest(c, 40, 8);
  assert.match((await c.get('/course/test/result')).text, /Not yet passed/); assert.equal(pendingRows(), before);
  // the test page is open again (retake works)
  assert.equal((await c.get('/course/test')).status, 200);
  await H.takeTest(c, 36, 9);
  assert.match((await c.get('/course/test/result')).text, /You passed/);
  assert.equal(status('retake@example.test'), 'waiting'); assert.equal(pendingRows(), before + 1);
  const uid = app.db.prepare('SELECT id FROM users WHERE email=?').get('retake@example.test').id;
  const at = app.db.prepare('SELECT score, child_correct, result, passed, created_at FROM attempts WHERE user_id=? ORDER BY id').all(uid);
  assert.deepEqual(at.map((x) => [x.score, x.child_correct, x.result]), [[25, 5, 'fail'], [48, 8, 'fail'], [45, 9, 'pass']]);
  assert.ok(at.every((x) => x.created_at));
  // after passing, the test is closed with the right message
  assert.match((await c.get('/course/test')).text, /You passed/);
  await H.takeTest(c, 40, 10); assert.equal(app.db.prepare('SELECT COUNT(*) c FROM attempts WHERE user_id=?').get(uid).c, 3, 'no more attempts once waiting');
});

test('the test must be fully answered', async () => {
  const c = app.client(); await H.signUp(c, { email: 'partial@example.test' });
  const a = H.answers(40, 10); delete a.q7; delete a.q45;
  const r = await c.post('/course/test', a);
  assert.equal(r.location, '/course/test');
  assert.match((await c.get('/course/test')).text, /Not answered yet: 7, 45/);
});

test('answer key is never sent to the browser (page source, JSON, other routes)', async () => {
  const c = app.client(); await H.signUp(c, { email: 'spy@example.test' });
  app.db.prepare("UPDATE questions SET answer_key=''").run();
  const t = await c.get('/course/test');
  assert.equal(t.status, 200);
  assert.doesNotMatch(t.text, /answer_key|answerKey|data-answer|data-correct|\bcorrect\b|checked/i, 'no key hints in the test page');
  // the question form is byte-for-byte the same with and without a key saved in the database
  const formOf = (h) => h.split('<form method="post" action="/course/test">')[1].split('</form>')[0];
  const noKey = formOf(t.text).replace(/value="[0-9a-f]{48}"/, '');
  app.setFakeKey();
  const withKey = formOf((await c.get('/course/test')).text).replace(/value="[0-9a-f]{48}"/, '');
  assert.equal(noKey, withKey, 'markup does not change when the key exists');
  assert.equal((await c.get('/admin/key')).status, 403);
  assert.equal((await c.post('/admin/key', { key: '1:A' })).status, 403);
  // the radio inputs only carry the letters, identical for every question
  const letters = [...t.text.matchAll(/name="q(\d+)" value="([A-D])"/g)];
  assert.equal(letters.length, 40 * 3 + 10 * 4);
  const res = await c.get('/course/test/result');
  assert.doesNotMatch(res.text, /answer_key/);
});

test('the pending list (admins only) shows name, e-mail, country chosen, best score, date, photo; badge count is right', async () => {
  const v1 = await H.waitingVolunteer(app, { name: 'Badge One', country: 'Nigeria' });
  const v2 = await H.waitingVolunteer(app, { name: 'Badge Two', country: 'Canada' });
  const n = pendingRows();
  const page = await adm.john.get('/admin/pending');
  assert.equal(page.status, 200);
  assert.match(page.text, /Badge One/); assert.match(page.text, /Badge Two/);
  assert.match(page.text, new RegExp(`<span class="badge" title="Waiting for approval">${n}</span>`));
  assert.match(page.text, new RegExp(`src="/photos/${v1.id}"`));
  assert.match(page.text, /50 of 50|\d+ of 50/); assert.match(page.text, /Country chosen/);
  // other pages show the same badge in the menu
  assert.match((await adm.abisade.get('/admin')).text, new RegExp(`class="badge"[^>]*>${n}<`));
  // volunteers cannot open it, signed-out people are redirected
  assert.equal((await v1.c.get('/admin/pending')).status, 403);
  assert.equal((await app.client().get('/admin/pending')).status, 302);
  // a volunteer's own view never lists others
  assert.doesNotMatch((await v1.c.get('/meeting-room')).text, /Badge Two/);
  // approving removes them from the list and lowers the badge
  await H.approve(adm.john, v2.id, 'Canada', 'Technology');
  assert.equal(pendingRows(), n - 1);
  assert.match((await adm.john.get('/admin/pending')).text, new RegExp(`title="Waiting for approval">${n - 1}</span>`));
});

test('the course page text matches COURSE_TEXT.txt word for word (lessons, pledge, tables, lists)', async () => {
  const c = app.client();
  const page = await c.get('/course');
  assert.equal(page.status, 200);
  const region = page.text.split('<div id="course-text" class="course-text">')[1].split('<div class="card gold">')[0];
  const decode = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const got = words(decode(region));
  const want = loadCourse(app.config.courseFile).expectedWords;
  assert.equal(got.length, want.length);
  assert.deepEqual(got, want);
  // 12 + 7 lessons, 50 questions in the file; key sentences present as written
  const course = loadCourse(app.config.courseFile);
  assert.equal(course.orientLessons.length, 12); assert.equal(course.ccpLessons.length, 7);
  for (const s of ['Volunteer Commitment and Loyalty Pledge', 'Lesson 12: Volunteer Recognition and Opportunities', 'Lesson 7: Data, photos and privacy', 'The 5 things to always remember', 'Honeyland College and Lagoon School']) assert.ok(region.includes(s.replace(/&/g, '&amp;')), s);
  // the builder notes are NOT on the page
  assert.doesNotMatch(page.text, /MEETING ROOM SITE NOTE|Removed from the public page/);
});
