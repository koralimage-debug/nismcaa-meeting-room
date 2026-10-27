'use strict';
/**
 * Test helpers: start isolated copies of the app (own temp DATA_DIR), a tiny HTTP client with a cookie jar
 * and CSRF handling, and shortcuts to create volunteers and admins through the REAL web forms.
 * The FAKE answer key lives only in test/fixtures (never in the production seed).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const sharp = require('sharp');
const { loadConfig, COUNTRIES, DEPARTMENTS } = require('../src/config');
const { createApp } = require('../src/app');

const FAKE = require('./fixtures/fake_key.json').key;

async function startApp(over = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-test-'));
  const config = loadConfig({ DATA_DIR: dataDir, QUIET: '1', SCRYPT_N: '1024', ...over.env });
  config.limits = { signupPerHour: 1e6, loginPer15Min: 1e6, claimPer15Min: 1e6, verifyPerMin: 1e6, ...(over.limits || {}) };
  if (over.today) config.todayOverride = over.today;
  const a = await createApp(config);
  const server = http.createServer(a.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const out = {
    ...a, base, dataDir, config, server,
    client: () => makeClient(base),
    async close() { await new Promise((r) => server.close(r)); a.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
    setFakeKey() { const u = a.db.prepare('UPDATE questions SET answer_key=? WHERE num=?'); a.db.transaction(() => Object.entries(FAKE).forEach(([n, l]) => u.run(l, Number(n))))(); },
  };
  return out;
}

function makeClient(base) {
  const jar = {};
  const c = {
    base, jar, csrf: null,
    async req(method, url, { form, json, multipart, headers = {}, redirect = 'manual' } = {}) {
      const h = { ...headers };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.cookie = cookie;
      let body;
      if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
      if (json) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
      if (multipart) body = multipart;
      const res = await fetch(base + url, { method, headers: h, body, redirect });
      (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((sc) => {
        const [kv] = sc.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1);
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const r = { status: res.status, headers: res.headers, buf, text: buf.toString('utf8'), location: res.headers.get('location'), setCookie: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
      const m = r.text.match(/<meta name="csrf-token" content="([^"]+)"/);
      if (m) c.csrf = m[1];
      return r;
    },
    get(url, o) { return c.req('GET', url, o); },
    async token() {
      let r = await c.get('/course');
      if (r.status === 302 && r.location) r = await c.get(r.location); // e.g. forced password-change page
      return c.csrf;
    },
    async post(url, form = {}, o = {}) { const _csrf = await c.token(); return c.req('POST', url, { form: { _csrf, ...form }, ...o }); },
    async postJson(url, json, o = {}) { const t = await c.token(); return c.req('POST', url, { json, headers: { 'x-csrf-token': t, accept: 'application/json' }, ...o }); },
    async postNoCsrf(url, form = {}) { return c.req('POST', url, { form }); },
  };
  return c;
}

async function fakePhoto(label = 'TEST') {
  return sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 30, g: 60, b: 120 } } })
    .composite([{ input: Buffer.from(`<svg width="300" height="300"><text x="40" y="170" font-size="60" fill="#fff">${label}</text></svg>`) }]).jpeg().toBuffer();
}

async function signUp(client, o = {}) {
  const t = await client.token();
  const fd = new FormData();
  fd.set('_csrf', t);
  fd.set('name', o.name || 'Test Person');
  fd.set('email', o.email || `test${Math.random().toString(36).slice(2, 8)}@example.test`);
  fd.set('password', o.password || 'correct-horse-battery');
  fd.set('password2', o.password2 || o.password || 'correct-horse-battery');
  fd.set('phone', o.phone || '+1 555 010 0000');
  fd.set('country', o.country || 'United States');
  if (o.age18 !== false) fd.set('age18', 'yes');
  if (o.photo !== false) fd.set('photo', new Blob([o.photo || (await fakePhoto())], { type: 'image/jpeg' }), o.photoName || 'me.jpg');
  return client.req('POST', '/sign-up', { multipart: fd });
}

async function signIn(client, email, password) { return client.post('/sign-in', { email, password }); }

/** Claim both admin accounts through /admin/claim and return signed-in clients { john, abisade }. */
async function admins(app) {
  const out = {};
  for (const [who, email] of [['john', 'interschoolmusic@gmail.com'], ['abisade', 'abisade@nismcaa.com']]) {
    const c = app.client();
    const r = await c.post('/admin/claim', { email, code: app.claimCodes[email], password: 'Admin-Test-Password-1', password2: 'Admin-Test-Password-1' });
    if (r.status !== 302) throw new Error('claim failed ' + r.status + r.text.slice(0, 300));
    out[who] = c;
  }
  return out;
}

/** answers for the test: `general` correct among Q1-40, `child` correct among Q41-50 (uses the fake key). */
function answers(general, child) {
  const a = {};
  for (let n = 1; n <= 50; n++) {
    const right = FAKE[n];
    const isChild = n > 40;
    const idx = isChild ? n - 41 : n - 1;
    const correct = isChild ? idx < child : idx < general;
    const letters = n <= 40 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
    a['q' + n] = correct ? right : letters.find((l) => l !== right);
  }
  return a;
}

const takeTest = (client, general, child) => client.post('/course/test', answers(general, child));

/** Create a signed-in volunteer who passed the test (needs the fake key set) and is waiting for approval. */
async function waitingVolunteer(app, o = {}) {
  const c = app.client();
  const email = o.email || `vol${Math.random().toString(36).slice(2, 8)}@example.test`;
  const r = await signUp(c, { name: o.name || 'Fake Volunteer', email, country: o.country || 'United States', password: o.password });
  if (r.status !== 302) throw new Error('signup failed: ' + r.text.slice(0, 400));
  await takeTest(c, 40, 10);
  const u = app.db.prepare('SELECT * FROM users WHERE email=?').get(email);
  return { c, email, id: u.id, password: o.password || 'correct-horse-battery' };
}

async function approve(adminClient, id, country, dept) {
  return adminClient.post(`/admin/pending/${id}/approve`, { country, department: dept });
}

async function approvedVolunteer(app, adm, o = {}) {
  const v = await waitingVolunteer(app, o);
  const r = await approve(adm.john, v.id, o.approveCountry || o.country || 'United States', o.dept || 'Technology');
  if (r.status !== 302) throw new Error('approve failed');
  return v;
}

module.exports = { startApp, makeClient, signUp, signIn, admins, answers, takeTest, waitingVolunteer, approve, approvedVolunteer, fakePhoto, FAKE, COUNTRIES, DEPARTMENTS };
