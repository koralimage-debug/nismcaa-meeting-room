'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { loadConfig } = require('../src/config');

let app;
before(async () => { app = await H.startApp(); });
after(async () => { await app.close(); });

test('home, sign-up and sign-in pages load', async () => {
  const c = app.client();
  for (const p of ['/', '/sign-up', '/sign-in', '/course']) assert.equal((await c.get(p)).status, 200, p);
});

test('sign-up works and creates an applicant who is signed in', async () => {
  const c = app.client();
  const r = await H.signUp(c, { name: 'Test Signup', email: 'signup1@example.test', country: 'Canada' });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/meeting-room');
  const u = app.db.prepare('SELECT * FROM users WHERE email=?').get('signup1@example.test');
  assert.equal(u.status, 'applicant'); assert.equal(u.country_chosen, 'Canada'); assert.equal(u.role, 'volunteer');
  assert.equal(u.country, null, 'final country is not set until an admin approves');
  const page = await c.get('/meeting-room');
  assert.match(page.text, /Welcome, <strong>Test Signup<\/strong>|Welcome, Test Signup/);
  assert.match(page.text, /Canada/); assert.match(page.text, /Applicant/);
});

test('sign-up validation: missing photo, short password, mismatch, no 18+ box, bad country, bad e-mail, duplicate', async () => {
  const c = app.client();
  const cases = [
    [{ photo: false }, /photo/i], [{ password: 'short' }, /at least 10/], [{ password: 'long-enough-pw1', password2: 'different-pw-123' }, /do not match/],
    [{ age18: false }, /18 or older/], [{ country: 'Atlantis' }, /choose the country/], [{ email: 'not-an-email' }, /valid e-mail/],
  ];
  for (const [o, re] of cases) {
    const r = await H.signUp(c, { email: `v${Math.random().toString(36).slice(2, 7)}@example.test`, ...o });
    assert.equal(r.status, 400); assert.match(r.text, re);
  }
  await H.signUp(app.client(), { email: 'dup@example.test' });
  const d = await H.signUp(app.client(), { email: 'DUP@example.test' });
  assert.equal(d.status, 400); assert.match(d.text, /already exists/);
});

test('photo rules: only JPG/PNG, max 2 MB', async () => {
  const c = app.client();
  const bad = await H.signUp(c, { photo: Buffer.from('this is not an image at all'), photoName: 'x.jpg', email: 'badphoto@example.test' });
  assert.equal(bad.status, 400); assert.match(bad.text, /JPG or PNG/);
  const big = await H.signUp(app.client(), { photo: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2.5 * 1024 * 1024)]), email: 'bigphoto@example.test' });
  assert.equal(big.status, 400); assert.match(big.text, /larger than 2 MB/);
});

test('passwords are stored hashed (scrypt), never in plain text', async () => {
  await H.signUp(app.client(), { email: 'hash@example.test', password: 'my-very-secret-pass-1' });
  const u = app.db.prepare('SELECT * FROM users WHERE email=?').get('hash@example.test');
  assert.match(u.pw_hash, /^scrypt\$\d+\$8\$1\$/);
  assert.ok(!u.pw_hash.includes('my-very-secret-pass-1'));
  const all = JSON.stringify(app.db.prepare('SELECT * FROM users').all());
  assert.ok(!all.includes('my-very-secret-pass-1'));
  const u2 = await (async () => { await H.signUp(app.client(), { email: 'hash2@example.test', password: 'my-very-secret-pass-1' }); return app.db.prepare('SELECT pw_hash FROM users WHERE email=?').get('hash2@example.test'); })();
  assert.notEqual(u.pw_hash, u2.pw_hash, 'same password gives a different hash (random salt)');
  assert.equal(loadConfig({}).scryptN, 16384, 'production default work factor');
});

test('sign-in works; wrong password and unknown e-mail give the same generic error', async () => {
  await H.signUp(app.client(), { email: 'login1@example.test', password: 'right-password-1' });
  const c = app.client();
  const ok = await H.signIn(c, 'login1@example.test', 'right-password-1');
  assert.equal(ok.status, 302); assert.equal(ok.location, '/meeting-room');
  assert.equal((await c.get('/meeting-room')).status, 200);
  const w = await H.signIn(app.client(), 'login1@example.test', 'wrong-password-1');
  const n = await H.signIn(app.client(), 'nobody@example.test', 'wrong-password-1');
  assert.equal(w.status, 401); assert.equal(n.status, 401);
  const msg = (t) => t.match(/class="flash err"[^>]*>([^<]+)</)[1];
  assert.equal(msg(w.text), msg(n.text)); assert.match(msg(w.text), /not correct/);
});

test('5 wrong tries lock the account for 15 minutes (even the right password is refused)', async () => {
  await H.signUp(app.client(), { email: 'lock@example.test', password: 'right-password-1' });
  const c = app.client();
  for (let i = 0; i < 5; i++) await H.signIn(c, 'lock@example.test', 'wrong-' + i + '-password');
  const r = await H.signIn(c, 'lock@example.test', 'right-password-1');
  assert.equal(r.status, 429); assert.match(r.text, /locked/);
  // lock expires: move it into the past
  app.db.prepare("UPDATE login_failures SET locked_until=?, first_at=? WHERE k='lock@example.test'").run(new Date(Date.now() - 1000).toISOString(), new Date(Date.now() - 3600e3).toISOString());
  const again = await H.signIn(c, 'lock@example.test', 'right-password-1');
  assert.equal(again.status, 302);
});

test('signed-out visitors are sent to sign-in; volunteers are blocked from /admin', async () => {
  const c = app.client();
  for (const p of ['/meeting-room/notes', '/meeting-room/chat/general', '/meeting-room/plan', '/admin', '/admin/pending', '/course/test']) {
    const r = await c.get(p); assert.equal(r.status, 302, p); assert.match(r.location, /^\/sign-in/, p);
  }
  await H.signUp(c, { email: 'plainvol@example.test' });
  for (const p of ['/admin', '/admin/pending', '/admin/people', '/admin/key', '/admin/settings', '/admin/heads', '/admin/log', '/admin/export/users.csv']) {
    assert.equal((await c.get(p)).status, 403, p);
  }
  assert.equal((await c.post('/admin/settings', { main: 'https://meet.example/x' })).status, 403);
});

test('admin accounts exist, have no password until claimed, and the claim page works once per person', async () => {
  const fresh = await H.startApp();
  try {
    const rows = fresh.db.prepare("SELECT email, role, pw_hash FROM users WHERE role='admin' ORDER BY email").all();
    assert.deepEqual(rows.map((r) => r.email), ['abisade@nismcaa.com', 'interschoolmusic@gmail.com']);
    assert.ok(rows.every((r) => r.pw_hash === null), 'no password is hard-coded');
    const file = require('fs').readFileSync(require('path').join(fresh.dataDir, 'ADMIN_CLAIM_CODES.txt'), 'utf8');
    assert.match(file, /interschoolmusic@gmail.com: [0-9A-F]{5}-[0-9A-F]{5}/);
    const cl = fresh.client();
    assert.equal((await cl.get('/admin/claim')).status, 200);
    // cannot sign in before claiming
    assert.equal((await H.signIn(fresh.client(), 'interschoolmusic@gmail.com', 'anything-at-all-1')).status, 401);
    // wrong code
    assert.equal((await cl.post('/admin/claim', { email: 'abisade@nismcaa.com', code: 'WRONG-CODE0', password: 'Admin-Test-Password-1', password2: 'Admin-Test-Password-1' })).status, 400);
    // a non-admin e-mail cannot claim
    assert.equal((await cl.post('/admin/claim', { email: 'someone@example.test', code: fresh.claimCodes['abisade@nismcaa.com'], password: 'Admin-Test-Password-1', password2: 'Admin-Test-Password-1' })).status, 400);
    // John claims
    const ok = await cl.post('/admin/claim', { email: 'interschoolmusic@gmail.com', code: fresh.claimCodes['interschoolmusic@gmail.com'], password: 'Admin-Test-Password-1', password2: 'Admin-Test-Password-1' });
    assert.equal(ok.status, 302); assert.equal(ok.location, '/admin');
    assert.equal((await cl.get('/admin')).status, 200);
    // the same code does not work twice
    assert.equal((await fresh.client().post('/admin/claim', { email: 'interschoolmusic@gmail.com', code: fresh.claimCodes['interschoolmusic@gmail.com'], password: 'Another-Password-22', password2: 'Another-Password-22' })).status, 400);
    // Abisade claims -> page switches off, file deleted
    const ab = fresh.client();
    assert.equal((await ab.post('/admin/claim', { email: 'abisade@nismcaa.com', code: fresh.claimCodes['abisade@nismcaa.com'], password: 'Admin-Test-Password-2', password2: 'Admin-Test-Password-2' })).status, 302);
    assert.equal((await fresh.client().get('/admin/claim')).status, 404, 'claim page is disabled after both claimed');
    assert.equal(require('fs').existsSync(require('path').join(fresh.dataDir, 'ADMIN_CLAIM_CODES.txt')), false);
    // admins can sign in normally
    const s = fresh.client(); assert.equal((await H.signIn(s, 'abisade@nismcaa.com', 'Admin-Test-Password-2')).status, 302);
    assert.equal((await s.get('/admin')).status, 200);
  } finally { await fresh.close(); }
});

test('CSRF: a POST without a valid token is refused; cookies are HttpOnly + SameSite', async () => {
  const c = app.client();
  await c.get('/sign-in');
  const r = await c.postNoCsrf('/sign-in', { email: 'x@example.test', password: 'whatever-1234' });
  assert.equal(r.status, 403);
  const first = await app.client().get('/sign-in');
  const sc = first.setCookie.join(';');
  assert.match(sc, /nm_sid=/); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
  assert.match(first.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(first.headers.get('x-frame-options'), 'DENY');
});

test('sessions end after 3 days unused', async () => {
  await H.signUp(app.client(), { email: 'idle@example.test', password: 'right-password-1' });
  const c = app.client(); await H.signIn(c, 'idle@example.test', 'right-password-1');
  assert.equal((await c.get('/meeting-room')).status, 200);
  app.db.prepare('UPDATE sessions SET last_seen=? WHERE user_id=(SELECT id FROM users WHERE email=?)').run(new Date(Date.now() - 3.1 * 24 * 3600e3).toISOString(), 'idle@example.test');
  const r = await c.get('/meeting-room');
  assert.equal(r.status, 302); assert.match(r.location, /sign-in/);
  // 2 days idle is still fine
  await H.signIn(c, 'idle@example.test', 'right-password-1');
  app.db.prepare('UPDATE sessions SET last_seen=? WHERE user_id=(SELECT id FROM users WHERE email=?)').run(new Date(Date.now() - 2 * 24 * 3600e3).toISOString(), 'idle@example.test');
  assert.equal((await c.get('/meeting-room')).status, 200);
});

test('"My country isn\'t listed" records interest only: no test, no access', async () => {
  const c = app.client();
  await H.signUp(c, { email: 'interest@example.test', country: "My country isn't listed" });
  const u = app.db.prepare('SELECT * FROM users WHERE email=?').get('interest@example.test');
  assert.equal(u.status, 'interest');
  const room = await c.get('/meeting-room'); assert.match(room.text, /interest only/i);
  assert.match((await c.get('/course/test')).text, /not on our list yet/);
  assert.equal((await c.get('/meeting-room/chat/general')).status, 403);
  assert.equal((await c.get('/meeting-room/plan')).status, 403);
  assert.equal((await c.get('/meeting-room/notes')).status, 403);
  // POSTing a test anyway does nothing
  await c.post('/course/test', H.answers(40, 10));
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM attempts WHERE user_id=?').get(u.id).c, 0);
});

test('change password: wrong current refused, new one works', async () => {
  await H.signUp(app.client(), { email: 'chg@example.test', password: 'old-password-123' });
  const c = app.client(); await H.signIn(c, 'chg@example.test', 'old-password-123');
  assert.equal((await c.post('/account/password', { current: 'nope-nope-nope', password: 'new-password-123', password2: 'new-password-123' })).status, 400);
  assert.equal((await c.post('/account/password', { current: 'old-password-123', password: 'new-password-123', password2: 'new-password-123' })).status, 302);
  assert.equal((await H.signIn(app.client(), 'chg@example.test', 'old-password-123')).status, 401);
  assert.equal((await H.signIn(app.client(), 'chg@example.test', 'new-password-123')).status, 302);
});
