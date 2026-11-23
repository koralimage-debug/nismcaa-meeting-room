'use strict';
/** Administrator pass notice: fake transport only, never a real SMTP connection. */
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const mail = require('../src/mail');
const { regradePending } = require('../src/routes/course');

let app, sent;

before(async () => {
  app = await H.startApp({ env: { PUBLIC_URL: 'https://meeting.nismcaa.com' } });
  app.setFakeKey();
});
after(async () => { mail._reset(); await app.close(); });

beforeEach(() => {
  sent = [];
  mail._reset();
  mail.configure({ quiet: true, publicUrl: 'https://meeting.nismcaa.com', displayTz: 'America/New_York' });
  mail._setTransport(async (msg) => { sent.push(msg); return { ok: true, fake: true }; });
});
afterEach(() => { mail._reset(); });

test('when a volunteer passes, John is e-mailed name, country, scores, date, and the approval link', async () => {
  const c = app.client();
  await H.signUp(c, { name: 'Amina Pass', email: 'amina.pass@example.test', country: 'Nigeria' });
  await H.takeTest(c, 36, 9); // 45/50, child 9
  await mail.flush();
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('amina.pass@example.test').status, 'waiting');
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'info@nismcaa.com');
  assert.equal(m.subject, 'A volunteer has passed the course: Amina Pass');
  assert.match(m.text, /Name: Amina Pass/);
  assert.match(m.text, /Country: Nigeria/);
  assert.match(m.text, /Score: 45\/50/);
  assert.match(m.text, /Child-protection score: 9\/10/);
  assert.match(m.text, /https:\/\/meeting\.nismcaa\.com\/admin\/pending/);
  assert.match(m.text, /Waiting for approval/);
  assert.match(m.text, /Date: .+\d{4}/);
  assert.doesNotMatch(m.text, /password|photo|\.jpg|\.png|claim code/i);
});

test('a failing attempt does not send e-mail, and a later pass sends one notice', async () => {
  const c = app.client();
  await H.signUp(c, { name: 'Retake Mail', email: 'retake.mail@example.test', country: 'Canada' });
  await H.takeTest(c, 20, 5);
  await mail.flush();
  assert.equal(sent.length, 0);
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('retake.mail@example.test').status, 'applicant');
  await H.takeTest(c, 40, 10);
  await mail.flush();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Name: Retake Mail/);
  assert.match(sent[0].text, /Country: Canada/);
  assert.match(sent[0].text, /Score: 50\/50/);
  assert.match(sent[0].text, /Child-protection score: 10\/10/);
});

test('when mail is not configured, a pass still works and no e-mail is sent', async () => {
  mail._reset();
  mail.configure({ quiet: true, publicUrl: 'https://meeting.nismcaa.com', displayTz: 'America/New_York' });
  const c = app.client();
  await H.signUp(c, { name: 'Silent Pass', email: 'silent.pass@example.test', country: 'United States' });
  const r = await H.takeTest(c, 40, 10);
  assert.equal(r.location, '/course/test/result');
  const flushed = await mail.flush();
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('silent.pass@example.test').status, 'waiting');
  assert.ok(flushed.every((x) => x && x.skipped));
  assert.equal(sent.length, 0);
});

test('grading a pending-key attempt as a pass also sends the notice', async () => {
  const c = app.client();
  await H.signUp(c, { name: 'Later Graded', email: 'later.graded@example.test', country: 'United Kingdom' });
  app.db.prepare("UPDATE questions SET answer_key=''").run();
  await H.takeTest(c, 40, 10);
  await mail.flush();
  assert.equal(sent.length, 0);
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('later.graded@example.test').status, 'applicant');
  app.setFakeKey();
  const n = regradePending(app.db);
  assert.ok(n >= 1);
  await mail.flush();
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('later.graded@example.test').status, 'waiting');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Name: Later Graded/);
  assert.match(sent[0].text, /Country: United Kingdom/);
  assert.match(sent[0].text, /Score: 50\/50/);
  assert.match(sent[0].text, /https:\/\/meeting\.nismcaa\.com\/admin\/pending/);
});

test('a thrown transport error is swallowed so the test flow still finishes', async () => {
  mail._setTransport(async () => { throw new Error('boom'); });
  const c = app.client();
  await H.signUp(c, { name: 'Error Pass', email: 'error.pass@example.test', country: 'Australia' });
  const r = await H.takeTest(c, 40, 10);
  assert.equal(r.location, '/course/test/result');
  const flushed = await mail.flush();
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('error.pass@example.test').status, 'waiting');
  assert.equal(flushed[0].ok, false);
  assert.match(flushed[0].error, /boom/);
});
