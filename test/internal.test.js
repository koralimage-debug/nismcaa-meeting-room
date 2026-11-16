'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const KEY = 'test-only-lookup-key-0123456789abcdef';
let app, adm;
before(async () => { app = await H.startApp({ env: { VOLUNTEER_LOOKUP_KEY: KEY } }); app.setFakeKey(); adm = await H.admins(app); });
after(async () => { await app.close(); });

const get = (url, key) => fetch(app.base + url, { headers: key === undefined ? {} : { 'x-internal-key': key } });

test('internal lookup needs the shared key', async () => {
  assert.equal((await get('/internal/volunteers/NISMCAA-VOL-0001')).status, 401);
  assert.equal((await get('/internal/volunteers/NISMCAA-VOL-0001', 'wrong')).status, 401);
  assert.equal((await get('/internal/volunteers/NISMCAA-VOL-0001', KEY + 'x')).status, 401);
  const r = await fetch(app.base + '/internal/volunteers', { method: 'POST', headers: { 'x-internal-key': KEY } });
  assert.equal(r.status, 405);
});

test('approved and current volunteer is found; unknown and bad format are not', async () => {
  const v = await H.approvedVolunteer(app, adm, { name: 'Ada Lookup', country: 'Nigeria' });
  const vid = app.db.prepare('SELECT volunteer_id FROM users WHERE id=?').get(v.id).volunteer_id;
  assert.match(vid, /^NISMCAA-VOL-\d{4}$/);
  const r = await get('/internal/volunteers/' + vid.toLowerCase(), KEY);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('set-cookie'), null, 'no session cookie for server calls');
  const j = await r.json();
  assert.equal(j.found, true); assert.equal(j.volunteer_id, vid); assert.equal(j.name, 'Ada Lookup');
  assert.equal(j.approved, true); assert.equal(j.current, true); assert.equal(j.id_state, 'VALID'); assert.equal(j.country, 'Nigeria');
  for (const k of ['email', 'phone', 'photo_file', 'password_hash']) assert.equal(k in j, false, k + ' must not be shared');
  assert.equal((await get('/internal/volunteers/NISMCAA-VOL-9999', KEY)).status, 404);
  assert.equal((await get('/internal/volunteers/NV-0001', KEY)).status, 400);
});

test('expired and ended IDs are found but not current', async () => {
  const v = await H.approvedVolunteer(app, adm, { name: 'Old Card' });
  const u = app.db.prepare('SELECT volunteer_id FROM users WHERE id=?').get(v.id);
  app.db.prepare("UPDATE users SET id_expires_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(v.id);
  let j = await (await get('/internal/volunteers/' + u.volunteer_id, KEY)).json();
  assert.equal(j.found, true); assert.equal(j.current, false); assert.equal(j.id_state, 'EXPIRED');
  app.db.prepare("UPDATE users SET id_status='ended', id_expires_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(v.id);
  j = await (await get('/internal/volunteers/' + u.volunteer_id, KEY)).json();
  assert.equal(j.current, false); assert.equal(j.id_state, 'ENDED');
});

test('unapproved, inactive and undated IDs cannot start shifts', async () => {
  const v = await H.approvedVolunteer(app, adm, { name: 'Unsafe Card' });
  const vid = app.db.prepare('SELECT volunteer_id FROM users WHERE id=?').get(v.id).volunteer_id;
  for (const changes of ["status='waiting'", "status='approved', id_status='suspended'", "id_status='active', id_expires_at=NULL", "id_expires_at='bad-date'"]) {
    app.db.prepare('UPDATE users SET ' + changes + ' WHERE id=?').run(v.id);
    const j = await (await get('/internal/volunteers/' + vid, KEY)).json();
    assert.equal(j.current, false);
  }
});

test('lookup is switched off without a long enough key', async () => {
  const off = await H.startApp({ env: { VOLUNTEER_LOOKUP_KEY: 'short' } });
  try {
    const r = await fetch(off.base + '/internal/volunteers/NISMCAA-VOL-0001', { headers: { 'x-internal-key': 'short' } });
    assert.equal(r.status, 503);
  } finally { await off.close(); }
});
