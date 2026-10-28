'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let app, adm, us, ng, spon, vend, spon2, pending;
const FUTURE = '2030-05-14';
// Posts the meeting form like a browser does (a repeated field for each ticked guest).
const mk = async (c, o) => {
  const f = { title: 'M', audience: 'sponsors', country: '', date: FUTURE, time: '10:00', tz: 'America/New_York', agenda: 'AGENDA TEXT', link: 'https://meet.jit.si/test', ...o };
  const pairs = [['_csrf', await c.token()]];
  for (const [k, v] of Object.entries(f)) { if (Array.isArray(v)) v.forEach((x) => pairs.push([k, x])); else pairs.push([k, v]); }
  return c.req('POST', '/admin/meetings', { form: pairs });
};
const idOf = (title) => app.db.prepare('SELECT id FROM meetings WHERE title=?').get(title).id;

async function guestSignUp(o = {}) {
  const c = app.client();
  const email = o.email || `g${Math.random().toString(36).slice(2, 8)}@example.test`;
  const r = await c.post('/guests/sign-up', { name: o.name || 'Guest Person', organization: o.organization || 'Acme Org', kind: o.kind || 'sponsor', email, password: 'guest-password-1', note: o.note || '' });
  return { c, email, r, id: () => app.db.prepare('SELECT id FROM users WHERE email=?').get(email).id };
}
async function approvedGuest(o) {
  const g = await guestSignUp(o);
  assert.equal(g.r.status, 302);
  assert.equal((await adm.john.post(`/admin/guests/${g.id()}/approve`)).status, 302);
  return g;
}

before(async () => {
  app = await H.startApp(); app.setFakeKey(); adm = await H.admins(app);
  us = await H.approvedVolunteer(app, adm, { name: 'Us Volunteer', country: 'United States', dept: 'Technology' });
  ng = await H.approvedVolunteer(app, adm, { name: 'Ng Volunteer', country: 'Nigeria', dept: 'Technology' });
  spon = await approvedGuest({ name: 'Sponsor One', organization: 'Sponsor Co', kind: 'sponsor' });
  spon2 = await approvedGuest({ name: 'Sponsor Two', organization: 'Second Sponsor', kind: 'sponsor' });
  vend = await approvedGuest({ name: 'Vendor One', organization: 'Vendor Co', kind: 'vendor' });
  pending = await guestSignUp({ name: 'Pending Guest', organization: 'Pending Co', kind: 'vendor', note: 'We print programs.' });
});
after(async () => { await app.close(); });

test('guest sign-up: short form, account is pending, only an admin can approve, reject and suspend', async () => {
  assert.equal((await app.client().get('/guests')).status, 200);
  assert.equal((await app.client().get('/guests/sign-up')).status, 200);
  const row = app.db.prepare("SELECT u.role, u.status, g.kind, g.organization, g.offer_note FROM users u JOIN guests g ON g.user_id=u.id WHERE u.email=?").get(pending.email);
  assert.deepEqual({ ...row }, { role: 'guest', status: 'guest_pending', kind: 'vendor', organization: 'Pending Co', offer_note: 'We print programs.' });
  assert.match((await pending.c.get('/guest')).text, /Waiting for approval/);
  const c = app.client();
  for (const bad of [{ name: '' }, { organization: '' }, { kind: 'volunteer' }, { email: 'nope' }, { password: 'short' }, { email: pending.email }]) {
    const r = await c.post('/guests/sign-up', { name: 'A Name', organization: 'Org', kind: 'sponsor', email: `x${Math.random()}@example.test`, password: 'long-enough-pw', ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal((await us.c.post(`/admin/guests/${pending.id()}/approve`)).status, 403);
  assert.equal((await spon.c.post(`/admin/guests/${pending.id()}/approve`)).status, 403);
  assert.equal((await app.client().get('/admin/guests')).status, 302);
  assert.equal((await spon.c.get('/admin/guests')).status, 403);
  assert.equal(app.db.prepare('SELECT status FROM users WHERE id=?').get(pending.id()).status, 'guest_pending');
  assert.match((await adm.john.get('/admin/guests')).text, /Pending Co/);
  await adm.john.post(`/admin/guests/${pending.id()}/reject`);
  assert.equal(app.db.prepare('SELECT status FROM users WHERE id=?').get(pending.id()).status, 'guest_rejected');
  await adm.john.post(`/admin/guests/${pending.id()}/approve`);
  assert.equal(app.db.prepare('SELECT status FROM users WHERE id=?').get(pending.id()).status, 'guest_approved');
  await adm.john.post(`/admin/guests/${pending.id()}/suspend`);
  assert.equal(app.db.prepare('SELECT status FROM users WHERE id=?').get(pending.id()).status, 'guest_suspended');
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id=?').get(pending.id()).c, 0, 'suspended guests are signed out');
  const again = app.client(); await H.signIn(again, pending.email, 'guest-password-1');
  assert.match((await again.get('/guest')).text, /Access paused/);
  await adm.john.post(`/admin/guests/${pending.id()}/reject`);
  assert.equal(app.db.prepare('SELECT status FROM users WHERE id=?').get(pending.id()).status, 'guest_suspended');
  assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE kind='guest_approve'").get());
});

test('guest sign-in lands on the Guest Meeting Room; volunteers still land on the Meeting Room', async () => {
  const c = app.client();
  const r = await H.signIn(c, spon.email, 'guest-password-1');
  assert.equal(r.status, 302); assert.equal(r.location, '/guest');
  const v = app.client(); const r2 = await H.signIn(v, us.email, us.password);
  assert.equal(r2.location, '/meeting-room');
  assert.equal((await spon.c.get('/meeting-room')).location, '/guest');
});

test('audience filtering: sponsors, vendors, specific guests, volunteers (by team)', async () => {
  await mk(adm.john, { title: 'ALL-SPONSORS-MTG', audience: 'sponsors' });
  await mk(adm.john, { title: 'ALL-VENDORS-MTG', audience: 'vendors' });
  await mk(adm.john, { title: 'INVITED-MTG', audience: 'invited', invitees: [String(spon2.id()), String(vend.id())] });
  await mk(adm.john, { title: 'VOL-ALL-MTG', audience: 'volunteers' });
  await mk(adm.john, { title: 'VOL-NG-MTG', audience: 'volunteers', country: 'Nigeria' });
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM meetings').get().c, 5);
  const page = async (g) => (await g.c.get('/guest')).text;
  const sp = await page(spon), sp2 = await page(spon2), vd = await page(vend);
  assert.match(sp, /ALL-SPONSORS-MTG/); assert.doesNotMatch(sp, /ALL-VENDORS-MTG|INVITED-MTG|VOL-/);
  assert.match(sp2, /ALL-SPONSORS-MTG/); assert.match(sp2, /INVITED-MTG/); assert.doesNotMatch(sp2, /ALL-VENDORS-MTG|VOL-/);
  assert.match(vd, /ALL-VENDORS-MTG/); assert.match(vd, /INVITED-MTG/); assert.doesNotMatch(vd, /ALL-SPONSORS-MTG|VOL-/);
  assert.match(sp, /AGENDA TEXT/); assert.match(sp, /href="https:\/\/meet\.jit\.si\/test"/); assert.match(sp, /Join the meeting/);
  const usPage = (await us.c.get('/meeting-room')).text, ngPage = (await ng.c.get('/meeting-room')).text;
  assert.match(usPage, /VOL-ALL-MTG/); assert.doesNotMatch(usPage, /VOL-NG-MTG|SPONSORS-MTG|VENDORS-MTG|INVITED-MTG/);
  assert.match(ngPage, /VOL-ALL-MTG/); assert.match(ngPage, /VOL-NG-MTG/); assert.doesNotMatch(ngPage, /SPONSORS-MTG|VENDORS-MTG|INVITED-MTG/);
  assert.doesNotMatch(sp2 + vd, /Pending Co|Sponsor Co/);
  assert.doesNotMatch(vd, /Second Sponsor/);
  const ad = (await adm.john.get('/admin/meetings')).text;
  for (const t of ['ALL-SPONSORS-MTG', 'ALL-VENDORS-MTG', 'INVITED-MTG', 'VOL-ALL-MTG', 'VOL-NG-MTG', 'All sponsors', 'All vendors', 'Specific guests']) assert.match(ad, new RegExp(t));
});

test('time zones: a meeting is stored in UTC and shown in its own zone (US Eastern default)', async () => {
  await mk(adm.john, { title: 'TZ-MTG', audience: 'sponsors', date: '2030-11-12', time: '14:00', tz: 'America/New_York' });
  const m = app.db.prepare("SELECT * FROM meetings WHERE title='TZ-MTG'").get();
  assert.equal(m.starts_at, '2030-11-12T19:00:00.000Z');
  assert.match((await spon.c.get('/guest')).text, /Nov 12, 2030, 2:00 PM EST/);
  assert.match((await adm.john.get(`/admin/meetings/${m.id}/edit`)).text, /value="14:00"/);
  assert.match((await adm.john.get('/admin/meetings/new')).text, /<option value="America\/New_York" selected>/);
});

test('meeting form validation and admin-only', async () => {
  for (const bad of [{ title: 'x' }, { link: 'http://insecure.example' }, { link: 'javascript:alert(1)' }, { date: '' }, { audience: 'everyone' }, { audience: 'invited' }, { audience: 'invited', invitees: [String(pending.id())] }, { tz: 'Mars/Base' }]) {
    const r = await mk(adm.john, { title: 'BAD-MTG', ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(app.db.prepare("SELECT COUNT(*) c FROM meetings WHERE title='BAD-MTG'").get().c, 0);
  for (const who of [us.c, spon.c, app.client()]) {
    const r = await mk(who, { title: 'HACK-MTG' });
    assert.ok([302, 403].includes(r.status));
  }
  assert.equal(app.db.prepare("SELECT COUNT(*) c FROM meetings WHERE title='HACK-MTG'").get().c, 0);
  const id = idOf('ALL-VENDORS-MTG');
  const r = await adm.john.post(`/admin/meetings/${id}`, { title: 'ALL-VENDORS-MTG', audience: 'sponsors', country: '', date: FUTURE, time: '11:30', tz: 'America/Chicago', agenda: '', link: 'https://zoom.us/j/1' });
  assert.equal(r.status, 302);
  assert.equal(app.db.prepare('SELECT audience FROM meetings WHERE id=?').get(id).audience, 'sponsors');
  assert.match((await spon.c.get('/guest')).text, /ALL-VENDORS-MTG/); assert.doesNotMatch((await vend.c.get('/guest')).text, /ALL-VENDORS-MTG/);
  assert.equal((await us.c.post(`/admin/meetings/${id}/delete`)).status, 403);
  assert.equal((await adm.john.post(`/admin/meetings/${id}/delete`)).status, 302);
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM meetings WHERE id=?').get(id).c, 0);
});

test('access isolation both ways: guests cannot open any volunteer page; volunteers cannot open the guest page', async () => {
  const volunteerUrls = ['/meeting-room/chat/general', '/meeting-room/chat/united-states', '/meeting-room/chat/united-states/messages', '/meeting-room/notes', '/meeting-room/plan', '/meeting-room/plan/about',
    '/meeting-room/plan/united-states/all', '/meeting-room/plan/global', '/meeting-room/id-card', '/meeting-room/id-card.png', '/course/test', '/course', '/admin', '/admin/pending', '/admin/people', '/admin/meetings', '/admin/guests', '/admin/export/users.csv', '/admin/key', '/admin/settings'];
  for (const g of [spon, vend]) for (const u of volunteerUrls) assert.equal((await g.c.get(u)).status, 403, 'guest must not open ' + u);
  assert.equal((await spon.c.postJson('/meeting-room/chat/general', { body: 'hi' })).status, 403);
  assert.equal((await spon.c.post('/meeting-room/notes', { title: 't', text: 'x' })).status, 403);
  assert.equal((await spon.c.post('/course/test', {})).status, 403);
  const gp = (await spon.c.get('/guest')).text;
  assert.doesNotMatch(gp, /child|protection|safeguard|Chat|Notes|Action plan|Volunteer course|Final test/i);
  assert.equal((await us.c.get('/guest')).status, 403);
  assert.equal((await app.client().get('/guest')).status, 302);
  assert.equal((await adm.john.get('/guest')).location, '/admin/meetings');
  assert.doesNotMatch((await adm.john.get('/admin/people')).text, /Sponsor One/);
  assert.doesNotMatch((await adm.john.get('/admin/export/users.csv')).text, /Sponsor One|sponsor/i);
  assert.equal((await adm.john.get('/admin/people/' + spon.id())).status, 404);
});

test('unapproved, rejected and suspended guests see no meetings', async () => {
  const w = await guestSignUp({ name: 'Wait Guest', organization: 'Wait Co', kind: 'sponsor' });
  await mk(adm.john, { title: 'SECRET-MTG', audience: 'sponsors' });
  const t = (await w.c.get('/guest')).text;
  assert.doesNotMatch(t, /SECRET-MTG|meet\.jit\.si/); assert.match(t, /Waiting for approval/);
  await adm.john.post(`/admin/guests/${w.id()}/approve`);
  assert.match((await w.c.get('/guest')).text, /SECRET-MTG/);
  await adm.john.post(`/admin/guests/${w.id()}/suspend`);
  const w2 = app.client(); await H.signIn(w2, w.email, 'guest-password-1');
  assert.doesNotMatch((await w2.get('/guest')).text, /SECRET-MTG/);
  assert.doesNotMatch((await adm.john.get('/admin/meetings/new')).text, /Wait Co/);
});

test('admin can reset a guest password once; the guest must choose a new one', async () => {
  const r = await adm.john.post(`/admin/guests/${vend.id()}/reset-password`);
  assert.match(r.text, /Temporary password for Vendor One/);
  const temp = /<code>([^<]+)<\/code>/.exec(r.text)[1];
  const c = app.client(); const s = await H.signIn(c, vend.email, temp);
  assert.equal(s.location, '/account/password');
});

test('reception home: signed-out visitors see the welcome, a tour of open pages and the join section; all tour pages open without signing in', async () => {
  const home = (await app.client().get('/')).text;
  assert.match(home.replace(/<[^>]+>/g, ''), /Welcome to the NISMCAA Meeting Room/); assert.match(home, /Take a look around/); assert.match(home, /Ready to join us\?/);
  assert.ok(home.indexOf('Take a look around') < home.indexOf('/guests/sign-up'), 'sign-up comes after the welcome');
  assert.doesNotMatch(home.slice(home.indexOf('</nav>'), home.indexOf('id="look-around"')), /sign-up/);
  for (const u of ['/about', '/benefits', '/contact', '/course', '/guests', '/guests/sign-up', '/guests/sign-in']) assert.equal((await app.client().get(u)).status, 200, u);
  // signed-in volunteers still see the member home
  assert.match((await us.c.get('/')).text, /Everything waiting for you/);
});
