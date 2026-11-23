'use strict';
/** Self-serve password reset for every signed-in role. Uses a fake mail transport only. */
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const H = require('./helpers');
const mail = require('../src/mail');
const pr = require('../src/password_reset');

let app, sent;

function tokenFrom(msg) {
  const m = String(msg && (msg.text || msg.html) || '').match(/\/reset-password\?token=([a-f0-9]{64})/);
  assert.ok(m, 'reset e-mail must include a 32-byte token link');
  return m[1];
}

before(async () => {
  app = await H.startApp({ env: { PUBLIC_URL: 'https://meeting.nismcaa.com' } });
});
after(async () => { mail._reset(); await app.close(); });

beforeEach(() => {
  sent = [];
  mail._reset();
  mail.configure({ quiet: true, publicUrl: 'https://meeting.nismcaa.com', displayTz: 'America/New_York' });
  mail._setTransport(async (msg) => { sent.push(msg); return { ok: true, fake: true }; });
});
afterEach(() => { mail._reset(); });

test('the sign-in page offers Forgot your password? and no longer says e-mail is not sent', async () => {
  const page = await app.client().get('/sign-in');
  assert.equal(page.status, 200);
  assert.match(page.text, /href="\/forgot-password"/);
  assert.match(page.text, /Forgot your password\?/);
  assert.doesNotMatch(page.text, /We do not send e-mail from this site/);
});

test('the forgot-password page has a CSRF form and always shows the same message whether or not the e-mail exists', async () => {
  const c = app.client();
  const get = await c.get('/forgot-password');
  assert.equal(get.status, 200);
  assert.match(get.text, /<form[^>]*action="\/forgot-password"/);
  assert.match(get.text, /name="_csrf"/);
  const unknown = await c.post('/forgot-password', { email: 'no-such-person@example.test' });
  assert.equal(unknown.status, 200);
  assert.match(unknown.text, /Check your e-mail/);
  assert.match(unknown.text, new RegExp(pr.SENT_MSG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(sent.length, 0);

  await H.signUp(app.client(), { name: 'Megan Shaw', email: 'megan.shaw@example.test' });
  const known = await app.client().post('/forgot-password', { email: 'megan.shaw@example.test' });
  assert.equal(known.status, 200);
  assert.equal(known.text.includes(pr.SENT_MSG), true);
  const strip = (s) => s.replace(/content="[^"]*"/g, '').replace(/value="[^"]*"/g, '');
  assert.equal(strip(unknown.text), strip(known.text), 'the confirmation must not reveal whether the account exists');
  assert.equal(sent.length, 1);
});

test('a reset link is random, at least 32 bytes, stored only as a hash, expires in 60 minutes, and works once', async () => {
  await H.signUp(app.client(), { name: 'Daniel Brooks', email: 'daniel.brooks@example.test', password: 'old-password-123' });
  await app.client().post('/forgot-password', { email: 'daniel.brooks@example.test' });
  assert.equal(sent.length, 1);
  const token = tokenFrom(sent[0]);
  assert.equal(Buffer.from(token, 'hex').length, 32);
  const rows = app.db.prepare('SELECT * FROM password_resets r JOIN users u ON u.id=r.user_id WHERE u.email=? ORDER BY r.id DESC').all('daniel.brooks@example.test');
  assert.ok(rows.length >= 1);
  const row = rows[0];
  assert.equal(row.token_hash, pr.hashToken(token));
  assert.notEqual(row.token_hash, token);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(token));
  const life = Date.parse(row.expires_at) - Date.parse(row.created_at);
  assert.ok(Math.abs(life - pr.TTL_MS) < 5000);

  const form = await app.client().get('/reset-password?token=' + token);
  assert.equal(form.status, 200);
  assert.match(form.text, /Set a new password/);
  assert.match(form.text, /name="_csrf"/);
  assert.match(form.text, /name="token"/);

  const save = await app.client().post('/reset-password', { token, password: 'new-password-123', password2: 'new-password-123' });
  assert.equal(save.status, 200);
  assert.match(save.text, /Your password is ready/);

  assert.equal((await H.signIn(app.client(), 'daniel.brooks@example.test', 'old-password-123')).status, 401);
  assert.equal((await H.signIn(app.client(), 'daniel.brooks@example.test', 'new-password-123')).status, 302);

  assert.equal((await app.client().get('/reset-password?token=' + token)).status, 400);
  assert.equal((await app.client().post('/reset-password', { token, password: 'other-password-123', password2: 'other-password-123' })).status, 400);
});

test('an expired or unknown token is rejected, and short or mismatched passwords are rejected without using the token', async () => {
  await H.signUp(app.client(), { name: 'Lauren Price', email: 'lauren.price@example.test', password: 'old-password-123' });
  await app.client().post('/forgot-password', { email: 'lauren.price@example.test' });
  const token = tokenFrom(sent[0]);
  app.db.prepare("UPDATE password_resets SET expires_at=? WHERE token_hash=?").run(new Date(Date.now() - 1000).toISOString(), pr.hashToken(token));
  const gone = await app.client().get('/reset-password?token=' + token);
  assert.equal(gone.status, 400);
  assert.match(gone.text, /This link has expired|not valid or has expired/);

  sent.length = 0;
  await app.client().post('/forgot-password', { email: 'lauren.price@example.test' });
  const fresh = tokenFrom(sent[0]);
  const short = await app.client().post('/reset-password', { token: fresh, password: 'short', password2: 'short' });
  assert.equal(short.status, 400);
  assert.match(short.text, /at least 10 characters/);
  const mismatch = await app.client().post('/reset-password', { token: fresh, password: 'new-password-123', password2: 'other-password-123' });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.text, /do not match/);
  // token still works
  const ok = await app.client().post('/reset-password', { token: fresh, password: 'new-password-123', password2: 'new-password-123' });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /Your password is ready/);

  const junk = await app.client().get('/reset-password?token=not-a-token');
  assert.equal(junk.status, 400);
});

test('reset works for an administrator and a guest, and an unclaimed admin is not e-mailed', async () => {
  const adm = await H.admins(app);
  sent.length = 0;
  const a = await app.client().post('/forgot-password', { email: 'interschoolmusic@gmail.com' });
  assert.equal(a.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Reset your NISMCAA Meeting Room password/);
  const adminTok = tokenFrom(sent[0]);
  const saved = await app.client().post('/reset-password', { token: adminTok, password: 'admin-reset-pw-1', password2: 'admin-reset-pw-1' });
  assert.equal(saved.status, 200);
  assert.equal((await H.signIn(app.client(), 'interschoolmusic@gmail.com', 'admin-reset-pw-1')).status, 302);

  const gc = app.client();
  const email = 'patrick.hughes@example.test';
  const g = await gc.post('/guests/sign-up', { name: 'Patrick Hughes', organization: 'Reset Org', kind: 'sponsor', email, password: 'guest-password-1', note: 'Help' });
  assert.equal(g.status, 302);
  sent.length = 0;
  await app.client().post('/forgot-password', { email });
  assert.equal(sent.length, 1);
  const gtok = tokenFrom(sent[0]);
  await app.client().post('/reset-password', { token: gtok, password: 'guest-password-2', password2: 'guest-password-2' });
  assert.equal((await H.signIn(app.client(), email, 'guest-password-2')).status, 302);

  // Abisade was claimed by H.admins in this same app. Use a fresh unclaimed address via a new isolated app:
  void adm;
});

test('an unclaimed administrator (no password yet) gets the same message and no e-mail', async () => {
  const isolated = await H.startApp({ env: { PUBLIC_URL: 'https://meeting.nismcaa.com' } });
  const inbox = [];
  mail._setTransport(async (msg) => { inbox.push(msg); return { ok: true, fake: true }; });
  mail.configure({ quiet: true, publicUrl: 'https://meeting.nismcaa.com', displayTz: 'America/New_York' });
  try {
    const r = await isolated.client().post('/forgot-password', { email: 'interschoolmusic@gmail.com' });
    assert.equal(r.status, 200);
    assert.match(r.text, new RegExp(pr.SENT_MSG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(inbox.length, 0);
  } finally {
    await isolated.close();
  }
});

test('a successful reset ends other sessions and sends a confirmation e-mail', async () => {
  await H.signUp(app.client(), { name: 'Rachel Adams', email: 'rachel.adams@example.test', password: 'old-password-123' });
  const a = app.client();
  const b = app.client();
  assert.equal((await H.signIn(a, 'rachel.adams@example.test', 'old-password-123')).status, 302);
  assert.equal((await H.signIn(b, 'rachel.adams@example.test', 'old-password-123')).status, 302);
  assert.equal((await a.get('/meeting-room')).status, 200);

  sent.length = 0;
  await app.client().post('/forgot-password', { email: 'rachel.adams@example.test' });
  const token = tokenFrom(sent[0]);
  const html = String(sent[0].html || '');
  assert.match(html, /Set a new password/);
  assert.match(html, /#C9A227|#c9a227|#EBCB63/);
  assert.match(html, /\/static\/img\/logo\.png/);
  assert.doesNotMatch(html + sent[0].text, /password-123|white box|Zoho|ChatGPT|OpenAI/i);

  const result = await app.client().post('/reset-password', { token, password: 'fresh-password-123', password2: 'fresh-password-123' });
  assert.match(result.text, /Your password is ready/);
  assert.equal((await a.get('/meeting-room')).status, 302);
  assert.equal((await b.get('/meeting-room')).status, 302);
  const confirm = sent.filter((m) => /password was changed/i.test(m.subject));
  assert.equal(confirm.length, 1);
  assert.match(confirm[0].text, /password for your NISMCAA Meeting Room account was just changed/);
  assert.match(confirm[0].html, /Sign in/);
});

test('missing mail settings still show the same message and do not throw', async () => {
  mail._reset();
  mail.configure({ quiet: true, publicUrl: 'https://meeting.nismcaa.com', displayTz: 'America/New_York' });
  await H.signUp(app.client(), { name: 'Brian Cole', email: 'brian.cole@example.test' });
  const r = await app.client().post('/forgot-password', { email: 'brian.cole@example.test' });
  assert.equal(r.status, 200);
  assert.match(r.text, new RegExp(pr.SENT_MSG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(sent.length, 0);
});

test('the forgot-password form requires a CSRF token', async () => {
  const c = app.client();
  await c.get('/forgot-password');
  const r = await c.postNoCsrf('/forgot-password', { email: 'anyone@example.test' });
  assert.equal(r.status, 403);
});

test('a second reset request for the same e-mail invalidates the first link', async () => {
  await H.signUp(app.client(), { name: 'Katie Morgan', email: 'katie.morgan@example.test', password: 'old-password-123' });
  await app.client().post('/forgot-password', { email: 'katie.morgan@example.test' });
  const first = tokenFrom(sent[0]);
  sent.length = 0;
  await app.client().post('/forgot-password', { email: 'katie.morgan@example.test' });
  const second = tokenFrom(sent[0]);
  assert.notEqual(first, second);
  assert.equal((await app.client().get('/reset-password?token=' + first)).status, 400);
  assert.equal((await app.client().get('/reset-password?token=' + second)).status, 200);
});
