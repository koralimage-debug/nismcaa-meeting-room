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
  await c.post('/course/test/start');
  const a = H.answers(40, 10); delete a.q7; delete a.q45;
  const r = await c.post('/course/test', a);
  assert.equal(r.location, '/course/test');
  assert.match((await c.get('/course/test')).text, /Not answered yet: 7, 45/);
});

test('answer key is never sent to the browser (page source, JSON, other routes)', async () => {
  const c = app.client(); await H.signUp(c, { email: 'spy@example.test' });
  app.db.prepare("UPDATE questions SET answer_key=''").run();
  await c.post('/course/test/start');
  const t = await c.get('/course/test');
  assert.equal(t.status, 200);
  assert.doesNotMatch(t.text, /answer_key|answerKey|data-answer|data-correct|\bcorrect\b|checked/i, 'no key hints in the test page');
  // the question form is byte-for-byte the same with and without a key saved in the database
  const formOf = (h) => h.split('<form method="post" action="/course/test"')[1].split('</form>')[0];
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
  assert.match((await adm.abisolami.get('/admin')).text, new RegExp(`class="badge"[^>]*>${n}<`));
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

test('the default time limit is 20 minutes and is shown before the test starts', async () => {
  assert.equal(app.config.testTimeLimitMin, 20);
  const c = app.client(); await H.signUp(c, { email: 'timerintro@example.test' });
  const intro = await c.get('/course/test');
  assert.equal(intro.status, 200);
  assert.match(intro.text, /20 minutes/);
  assert.match(intro.text, /Start the test/);
  assert.doesNotMatch(intro.text, /name="q1"/);
  assert.doesNotMatch(intro.text, /Time left:/);
});

test('the test timer is stored on the attempt; time out ends it, and a restart reshuffles questions and answers', async () => {
  const c = app.client(); await H.signUp(c, { email: 'timer@example.test' });
  const start = await c.post('/course/test/start');
  assert.equal(start.status, 302);
  assert.equal(start.location, '/course/test');

  const uid = app.db.prepare('SELECT id FROM users WHERE email=?').get('timer@example.test').id;
  const a1 = app.db.prepare("SELECT * FROM attempts WHERE user_id=? AND result='in_progress'").get(uid);
  assert.ok(a1, 'an in-progress attempt is saved when the test starts');
  assert.ok(a1.started_at);
  assert.ok(a1.order_json);
  const order1 = JSON.parse(a1.order_json);
  assert.equal(order1.questions.length, 50);
  assert.deepEqual([...order1.questions.slice(0, 40)].sort((x, y) => x - y), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.deepEqual([...order1.questions.slice(40)].sort((x, y) => x - y), [41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
  assert.notDeepEqual(order1.questions, Array.from({ length: 50 }, (_, i) => i + 1), 'question order is shuffled');

  const qOrder = (h) => [...h.matchAll(/id="question-(\d+)"/g)].map((m) => Number(m[1]));
  const optOrder = (h, n) => {
    const block = h.split('id="question-' + n + '"')[1].split('</fieldset>')[0];
    return [...block.matchAll(/value="([A-D])"/g)].map((m) => m[1]);
  };
  const formOf = (h) => h.split('<form method="post" action="/course/test"')[1].split('</form>')[0];

  const page1 = await c.get('/course/test');
  assert.equal(page1.status, 200);
  assert.match(page1.text, /Time left:/);
  assert.match(page1.text, /data-ends-at="20\d{2}-/);
  assert.deepEqual(qOrder(page1.text), order1.questions);
  const firstQ = order1.questions[0];
  const storedOpts = order1.options[String(firstQ)] || order1.options[firstQ];
  assert.deepEqual(optOrder(page1.text, firstQ), storedOpts);

  // Refresh must keep the same start time, the same remaining window, and the same question order.
  const page2 = await c.get('/course/test');
  assert.deepEqual(qOrder(page2.text), order1.questions);
  assert.deepEqual(optOrder(page2.text, firstQ), storedOpts);
  const a1b = app.db.prepare('SELECT started_at, order_json FROM attempts WHERE id=?').get(a1.id);
  assert.equal(a1b.started_at, a1.started_at);
  assert.equal(a1b.order_json, a1.order_json);
  const ends1 = (page1.text.match(/data-ends-at="([^"]+)"/) || [])[1];
  const ends2 = (page2.text.match(/data-ends-at="([^"]+)"/) || [])[1];
  assert.equal(ends1, ends2);
  assert.equal(
    formOf(page1.text).replace(/value="[0-9a-f]{48}"/, ''),
    formOf(page2.text).replace(/value="[0-9a-f]{48}"/, ''),
  );

  // Time has run out: a late submit is not marked, and the volunteer must restart.
  const past = new Date(Date.now() - (app.config.testTimeLimitMin * 60 * 1000 + 1000)).toISOString();
  app.db.prepare('UPDATE attempts SET started_at=? WHERE id=?').run(past, a1.id);
  const late = await c.post('/course/test', H.answers(40, 10));
  assert.equal(late.status, 302);
  assert.equal(late.location, '/course/test');
  const ended = app.db.prepare('SELECT * FROM attempts WHERE id=?').get(a1.id);
  assert.equal(ended.result, 'timed_out');
  assert.equal(ended.passed, 0);
  assert.equal(ended.score, null);
  assert.equal(status('timer@example.test'), 'applicant');

  const up = await c.get('/course/test');
  assert.match(up.text, /Time is up/);
  assert.match(up.text, /start the test again/i);
  assert.match(up.text, /new order/i);
  assert.doesNotMatch(up.text, /name="q1"/);
  assert.doesNotMatch(up.text, /Time left:/);
  assert.match((await c.get('/course/test/result')).text, /Time is up/);

  // A new attempt gets a new start time and a new shuffle.
  await c.post('/course/test/start');
  const a2 = app.db.prepare("SELECT * FROM attempts WHERE user_id=? AND result='in_progress'").get(uid);
  assert.ok(a2);
  assert.notEqual(a2.id, a1.id);
  assert.notEqual(a2.started_at, past);
  const order2 = JSON.parse(a2.order_json);
  assert.notDeepEqual(order2.questions, order1.questions);
  const optChanged = order1.questions.some((n) => {
    const o1 = order1.options[String(n)] || order1.options[n];
    const o2 = order2.options[String(n)] || order2.options[n];
    return JSON.stringify(o1) !== JSON.stringify(o2);
  });
  assert.ok(optChanged, 'answer choices should be reshuffled on a new attempt');
  const page3 = await c.get('/course/test');
  assert.deepEqual(qOrder(page3.text), order2.questions);
  assert.match(page3.text, /Time left:/);
  assert.doesNotMatch(page3.text, /Time is up/);
});

