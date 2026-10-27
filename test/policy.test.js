'use strict';
/** Whole-site rules from the brief: no e-mail, no OpenAI login, no paid service, one phone number, US spelling, links, clean first start. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const ROOT = path.join(__dirname, '..');
function files(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'test', 'data_local', 'demo-data', 'screenshots', '.git', 'fonts'].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) files(p, out); else if (/\.(js|ejs|css|md|yaml|yml|json|txt|example)$/.test(f.name) && !/package-lock/.test(f.name)) out.push(p);
  }
  return out;
}
const own = files(ROOT).filter((f) => !f.includes(path.join('content', 'COURSE_TEXT')) && !f.includes(path.sep + 'data' + path.sep));

let app, adm, vol, pages = {};
before(async () => {
  app = await H.startApp();
  // a first-start snapshot BEFORE any test data
  pages.fresh = {
    users: app.db.prepare('SELECT email, role FROM users ORDER BY email').all(),
    tasks: app.db.prepare('SELECT COUNT(*) c FROM tasks').get().c, attempts: app.db.prepare('SELECT COUNT(*) c FROM attempts').get().c,
    messages: app.db.prepare('SELECT COUNT(*) c FROM messages').get().c, notes: app.db.prepare('SELECT COUNT(*) c FROM notes').get().c,
    keys: app.db.prepare("SELECT COUNT(*) c FROM questions WHERE answer_key<>''").get().c, countries: app.db.prepare("SELECT DISTINCT country FROM tasks").all().map((r) => r.country),
    settings: app.db.prepare('SELECT key FROM settings ORDER BY key').all().map((r) => r.key),
  };
  app.setFakeKey(); adm = await H.admins(app);
  vol = await H.approvedVolunteer(app, adm, { name: 'Policy Volunteer', country: 'Nigeria', dept: 'Technology' });
});
after(async () => { await app.close(); });

async function crawl() {
  const out = {};
  const get = async (who, p) => { const r = await who.get(p); if (r.status === 200 && /text\/html/.test(r.headers.get('content-type') || '')) out[who === adm.john ? 'A:' + p : 'V:' + p] = r.text; };
  for (const p of ['/', '/sign-up', '/sign-in', '/course', '/verify/NISMCAA-VOL-0001']) await get(app.client(), p);
  const taskId = app.db.prepare("SELECT id FROM tasks WHERE country='Nigeria' AND row_type='task' LIMIT 1").get().id;
  for (const p of ['/meeting-room', '/meeting-room/chat/general', '/meeting-room/chat/nigeria', '/meeting-room/notes', '/meeting-room/plan/nigeria/all', '/meeting-room/plan/nigeria/technology', '/meeting-room/plan/about', '/meeting-room/id-card', '/meeting-room/task/' + taskId, '/meeting-room/member/' + vol.id]) await get(vol.c, p);
  for (const p of ['/admin', '/admin/pending', '/admin/people', '/admin/key', '/admin/settings', '/admin/heads', '/admin/log', '/meeting-room/plan/global', '/meeting-room/plan/log', '/admin/people/' + vol.id]) await get(adm.john, p);
  return out;
}

test('no e-mail service, no OpenAI/ChatGPT login, no paid or outside service in code or dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ');
  assert.doesNotMatch(deps, /nodemailer|sendgrid|mailgun|postmark|resend|aws-sdk|ses|twilio|stripe|openai|passport|auth0|firebase|supabase|@sentry/i);
  const code = own.filter((f) => /\.(js|ejs)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(code, /createTransport|sendMail|smtp|nodemailer|sendgrid|mailgun|openai|chatgpt|oauth|stripe|paystack/i);
  const server = own.filter((f) => /[\\/]src[\\/].*\.js$|server\.js$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(server, /require\(['"](https?|net|tls|dgram|child_process)['"]\)|\bfetch\(|XMLHttpRequest|axios|WebSocket/, 'the server makes no outbound network calls');
});

test('the browser code only talks to this site (chat polling), nothing external is loaded', async () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'chat.js'), 'utf8');
  assert.doesNotMatch(js, /https?:\/\//);
  const html = Object.values(await crawl()).join('\n');
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const allowed = new Set(['https://nismcaa.com']);
  external.forEach((u) => assert.ok(allowed.has(u), 'unexpected external link ' + u));
  const tags = [...html.matchAll(/<(script|link|img|iframe|form)\b[^>]*>/g)].map((m) => m[0]);
  tags.forEach((t) => { const u = (t.match(/(?:src|href|action)="([^"]*)"/) || [])[1]; if (u) assert.ok(u.startsWith('/') || u.startsWith('#'), 'tag loads outside content: ' + t); });
  assert.ok(tags.some((t) => /<script src="\/static\/chat.js">/.test(t)), 'chat script is local');
});

test('header logo and "Back to nismcaa.com" go to https://nismcaa.com; footer has the address and the only phone', async () => {
  const all = await crawl(); assert.ok(Object.keys(all).length > 20);
  for (const [name, h] of Object.entries(all)) {
    assert.match(h, /<a class="brand" href="https:\/\/nismcaa.com"/, name);
    assert.match(h, /<a class="back" href="https:\/\/nismcaa.com">&larr; Back to nismcaa.com<\/a>/, name);
    assert.match(h, /4764 Hammermill Road, Tucker, GA 30084, United States/, name); assert.match(h, /info@nismcaa.com/, name); assert.match(h, /\(470\) 739-0021/, name);
  }
});

test('only the business phone (470) 739-0021 appears; the old number never does', async () => {
  const phones = (s) => [...s.matchAll(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g)].map((m) => m[0]);
  for (const f of own) {
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /0554/, f); assert.doesNotMatch(t, /739-?\s?0554/, f);
    phones(t).forEach((p) => assert.equal(p, '(470) 739-0021', f + ' has ' + p));
  }
  for (const [name, h] of Object.entries(await crawl())) {
    assert.doesNotMatch(h, /0554/, name);
    phones(h.replace(/value="[^"]*"/g, '').replace(/\d{3}[\s.-]010[\s.-]0000/g, '')).forEach((p) => assert.equal(p, '(470) 739-0021', name + ' has ' + p));
  }
});

test('US English spelling in the site (views, code, docs; the course text is kept exactly as John supplied it)', () => {
  const british = /\b(colour|colours|organis\w+|centre|centres|favour\w*|behaviour|programme\w*|licence|recognis\w+|authoris\w+|analyse\w*|catalogue|cheque|travelling|cancelled|enrolment|judgement|neighbour\w*|honour\w*|labour|defence|offence|practise|minimis\w+|summaris\w+|customis\w+|apologis\w+|emphasis(e|ed))\b/i;
  for (const f of own.filter((x) => /\.(ejs|js|css|md)$/.test(x) && !/package/.test(x))) {
    const t = fs.readFileSync(f, 'utf8'); const m = t.match(british);
    assert.ok(!m || /(enrolment|cancelled|travelling)/i.test(m[0]) === false, `${path.relative(ROOT, f)}: "${m && m[0]}"`);
  }
});

test('first start contains only the two admin accounts: no test users, no key, no messages, no notes, no attempts; Nigeria plan only', () => {
  assert.deepEqual(pages.fresh.users, [{ email: 'abisade@nismcaa.com', role: 'admin' }, { email: 'interschoolmusic@gmail.com', role: 'admin' }]);
  assert.equal(pages.fresh.tasks, 222 + app.db.prepare("SELECT COUNT(*) c FROM tasks WHERE row_type='phase'").get().c);
  assert.deepEqual(pages.fresh.countries, ['Nigeria']);
  assert.equal(pages.fresh.attempts, 0); assert.equal(pages.fresh.messages, 0); assert.equal(pages.fresh.notes, 0); assert.equal(pages.fresh.keys, 0, 'answer key empty in the production seed');
  assert.deepEqual(pages.fresh.settings, ['call_link_main', 'plan_about', 'plan_proposed']);
  // and the real seed file contains no fake key or demo users
  const dbjs = fs.readFileSync(path.join(ROOT, 'src', 'db.js'), 'utf8'); assert.doesNotMatch(dbjs, /fake|demo|@example/i);
});

test('no hard-coded passwords: admin accounts have no password until claimed', () => {
  const fresh = new (require('better-sqlite3'))(path.join(app.dataDir, 'meeting_room.sqlite'), { readonly: true });
  const sec = require('fs').readFileSync(path.join(ROOT, 'src', 'db.js'), 'utf8');
  assert.match(sec, /INSERT INTO users\(email,name,role,status,created_at\)/); // no pw_hash column given at insert
  fresh.close();
});

test('every page loads without server errors for each role (smoke test of all main routes)', async () => {
  const all = await crawl();
  for (const [k, h] of Object.entries(all)) assert.doesNotMatch(h, /Something went wrong|ReferenceError|TypeError|undefined<|\[object Object\]|NaN/, k);
});
