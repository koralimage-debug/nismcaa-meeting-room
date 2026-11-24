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
  await H.signUp(c, { name: 'Emily Carter', email: 'emily.carter@example.test', country: 'United States' });
  await H.takeTest(c, 36, 9); // 45/50, child 9
  await mail.flush();
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('emily.carter@example.test').status, 'waiting');
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'info@nismcaa.com');
  assert.equal(m.subject, 'Please review: Emily Carter passed the Meeting Room course');
  assert.match(m.text, /Name: Emily Carter/);
  assert.match(m.text, /E-mail: emily\.carter@example\.test/);
  assert.match(m.text, /Country: United States/);
  assert.match(m.text, /Score: 45\/50 \(pass mark is 40\/50\)/);
  assert.match(m.text, /Child-protection score: 9\/10 \(pass mark is 9\/10\)/);
  assert.match(m.text, /Date and time: .+\d{4}/);
  assert.match(m.text, /Please review and approve this volunteer here:/);
  assert.match(m.text, /https:\/\/meeting\.nismcaa\.com\/admin\/pending/);
  assert.match(m.html, /Review and approve/);
  assert.match(m.html, /#C9A227|#c9a227|#EBCB63/);
  assert.match(m.html, /\/static\/img\/logo\.png/);
  assert.doesNotMatch(m.text + m.html, /password|photo|\.jpg|claim code|Zoho|ChatGPT|OpenAI/i);
  assert.match(m.html, /info@nismcaa\.com/);
  assert.match(m.html, /\(470\) 684-4463/);
  assert.doesNotMatch(m.text + m.html, /Hammermill|Tucker, GA 30084/);

});

test('a failing attempt does not send e-mail, and a later pass sends one notice', async () => {
  const c = app.client();
  await H.signUp(c, { name: 'James Miller', email: 'james.miller@example.test', country: 'Canada' });
  await H.takeTest(c, 20, 5);
  await mail.flush();
  assert.equal(sent.length, 0);
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('james.miller@example.test').status, 'applicant');
  await H.takeTest(c, 40, 10);
  await mail.flush();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Name: James Miller/);
  assert.match(sent[0].text, /Country: Canada/);
  assert.match(sent[0].text, /E-mail: james\.miller@example\.test/);
  assert.match(sent[0].text, /Score: 50\/50 \(pass mark is 40\/50\)/);
  assert.match(sent[0].text, /Child-protection score: 10\/10 \(pass mark is 9\/10\)/);
});

test('when mail is not configured, a pass still works and no e-mail is sent', async () => {
  mail._reset();
  mail.configure({ quiet: true, publicUrl: 'https://meeting.nismcaa.com', displayTz: 'America/New_York' });
  const c = app.client();
  await H.signUp(c, { name: 'Olivia Harris', email: 'olivia.harris@example.test', country: 'United States' });
  const r = await H.takeTest(c, 40, 10);
  assert.equal(r.location, '/course/test/result');
  const flushed = await mail.flush();
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('olivia.harris@example.test').status, 'waiting');
  assert.ok(flushed.every((x) => x && x.skipped));
  assert.equal(sent.length, 0);
});

test('grading a pending-key attempt as a pass also sends the notice', async () => {
  const c = app.client();
  await H.signUp(c, { name: 'Sarah Bennett', email: 'sarah.bennett@example.test', country: 'United Kingdom' });
  app.db.prepare("UPDATE questions SET answer_key=''").run();
  await H.takeTest(c, 40, 10);
  await mail.flush();
  assert.equal(sent.length, 0);
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('sarah.bennett@example.test').status, 'applicant');
  app.setFakeKey();
  const n = regradePending(app.db);
  assert.ok(n >= 1);
  await mail.flush();
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('sarah.bennett@example.test').status, 'waiting');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Name: Sarah Bennett/);
  assert.match(sent[0].text, /Country: United Kingdom/);
  assert.match(sent[0].text, /E-mail: sarah\.bennett@example\.test/);
  assert.match(sent[0].text, /Score: 50\/50 \(pass mark is 40\/50\)/);
  assert.match(sent[0].text, /https:\/\/meeting\.nismcaa\.com\/admin\/pending/);
});

test('a thrown transport error is swallowed so the test flow still finishes', async () => {
  mail._setTransport(async () => { throw new Error('boom'); });
  const c = app.client();
  await H.signUp(c, { name: 'Michael Brooks', email: 'michael.brooks@example.test', country: 'Australia' });
  const r = await H.takeTest(c, 40, 10);
  assert.equal(r.location, '/course/test/result');
  const flushed = await mail.flush();
  assert.equal(app.db.prepare('SELECT status FROM users WHERE email=?').get('michael.brooks@example.test').status, 'waiting');
  assert.equal(flushed[0].ok, false);
  assert.match(flushed[0].error, /boom/);
});

test('default SMTP host is smtp.zoho.com, matching the working payments mailer; ZOHO_SMTP_HOST can override it', () => {
  const orig = process.env.ZOHO_SMTP_HOST;
  try {
    delete process.env.ZOHO_SMTP_HOST;
    assert.equal(mail.DEFAULT_HOST, 'smtp.zoho.com');
    assert.equal(mail.host(), 'smtp.zoho.com');
    assert.equal(mail.port(), 465);
    process.env.ZOHO_SMTP_HOST = 'smtppro.zoho.com';
    assert.equal(mail.host(), 'smtppro.zoho.com');
  } finally {
    if (orig === undefined) delete process.env.ZOHO_SMTP_HOST;
    else process.env.ZOHO_SMTP_HOST = orig;
  }
});
