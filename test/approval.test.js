'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const jsQR = require('jsqr');
const { loadImage, createCanvas } = require('@napi-rs/canvas');

let app, adm;
before(async () => { app = await H.startApp(); app.setFakeKey(); adm = await H.admins(app); });
after(async () => { await app.close(); });

const user = (id) => app.db.prepare('SELECT * FROM users WHERE id=?').get(id);

test('approval gives a unique ID, 1-year validity, placement; volunteer gets Meeting Room access', async () => {
  const v = await H.waitingVolunteer(app, { name: 'Fake Approved', country: 'Canada' });
  assert.equal((await v.c.get('/meeting-room/chat/general')).status, 403, 'no access before approval');
  const r = await H.approve(adm.john, v.id, 'Canada', 'Media & Communications');
  assert.equal(r.status, 302);
  const u = user(v.id);
  assert.equal(u.status, 'approved'); assert.match(u.volunteer_id, /^NISMCAA-VOL-\d{4}$/);
  assert.equal(u.country, 'Canada'); assert.equal(u.department, 'Media & Communications'); assert.equal(u.id_status, 'active');
  const years = (Date.parse(u.id_expires_at) - Date.parse(u.id_issued_at)) / (365 * 24 * 3600e3);
  assert.ok(years > 0.99 && years < 1.01, 'valid for one year');
  assert.equal((await v.c.get('/meeting-room')).status, 200);
  assert.match((await v.c.get('/meeting-room')).text, /Join the call|Join call/);
  assert.equal((await v.c.get('/meeting-room/chat/general')).status, 200);
  const log = app.db.prepare("SELECT * FROM audit_log WHERE kind='approve' ORDER BY id DESC").get();
  assert.match(log.detail, new RegExp(u.volunteer_id));
  // cannot approve twice
  const again = await H.approve(adm.john, v.id, 'Canada', 'Technology');
  assert.equal(user(v.id).department, 'Media & Communications');
  // approve needs a supported country and a department
  const w = await H.waitingVolunteer(app);
  await adm.john.post(`/admin/pending/${w.id}/approve`, { country: 'Narnia', department: 'Technology' });
  await adm.john.post(`/admin/pending/${w.id}/approve`, { country: 'Nigeria', department: 'Nope' });
  assert.equal(user(w.id).status, 'waiting');
});

test('admin can correct the chosen country at approval; the correction is logged; volunteer cannot change it afterwards', async () => {
  const v = await H.waitingVolunteer(app, { country: 'United States' });
  await H.approve(adm.abisade, v.id, 'United Kingdom', 'Finance & Admin');
  const u = user(v.id);
  assert.equal(u.country_chosen, 'United States'); assert.equal(u.country, 'United Kingdom');
  assert.match(app.db.prepare("SELECT detail FROM audit_log WHERE kind='approve' ORDER BY id DESC").get().detail, /volunteer chose: United States; corrected by admin/);
  // volunteer: no way to change it (no form, and posts to plausible endpoints do nothing)
  const page = await v.c.get('/meeting-room');
  assert.doesNotMatch(page.text, /name="country"/);
  for (const url of ['/account', '/meeting-room', '/account/country', '/sign-up', '/admin/people/' + v.id + '/placement', '/admin/pending/' + v.id + '/approve']) {
    await v.c.post(url, { country: 'Nigeria', department: 'Technology' });
  }
  assert.equal(user(v.id).country, 'United Kingdom'); assert.equal(user(v.id).department, 'Finance & Admin');
  // admin may change it later (logged)
  assert.equal((await adm.john.post(`/admin/people/${v.id}/placement`, { country: 'Australia', department: 'Technology' })).status, 302);
  assert.equal(user(v.id).country, 'Australia');
  assert.match(app.db.prepare("SELECT detail FROM audit_log WHERE kind='placement' ORDER BY id DESC").get().detail, /United Kingdom -> Australia/);
});

test('volunteer IDs are unique, correctly formatted and never reused', async () => {
  const ids = [];
  for (let i = 0; i < 6; i++) { const v = await H.approvedVolunteer(app, adm, { name: 'Unique ' + i }); ids.push(user(v.id).volunteer_id); }
  assert.equal(new Set(ids).size, 6); ids.forEach((id) => assert.match(id, /^NISMCAA-VOL-\d{4}$/));
  const nums = ids.map((x) => Number(x.slice(-4))); for (let i = 1; i < nums.length; i++) assert.ok(nums[i] > nums[i - 1]);
  // delete the newest person, approve someone new: the freed number is NOT handed out again
  const last = app.db.prepare('SELECT id FROM users WHERE volunteer_id=?').get(ids[5]);
  app.db.prepare('DELETE FROM users WHERE id=?').run(last.id);
  const nv = await H.approvedVolunteer(app, adm, { name: 'After Delete' });
  assert.ok(Number(user(nv.id).volunteer_id.slice(-4)) > nums[5], 'number not reused');
  // database-level guarantee
  assert.throws(() => app.db.prepare('UPDATE users SET volunteer_id=? WHERE id=?').run(ids[0], user(nv.id).id), /UNIQUE/);
});

test('decline: volunteer sees "Not approved at this time."; the reason is private to admins', async () => {
  const v = await H.waitingVolunteer(app, { name: 'Declined Person' });
  assert.equal((await adm.john.post(`/admin/pending/${v.id}/decline`, { reason: '' })).status, 302);
  assert.equal(user(v.id).status, 'waiting', 'a reason is required');
  await adm.john.post(`/admin/pending/${v.id}/decline`, { reason: 'PRIVATE-REASON-XYZ' });
  const page = await v.c.get('/meeting-room');
  assert.match(page.text, /Not approved at this time/); assert.doesNotMatch(page.text, /PRIVATE-REASON-XYZ/);
  assert.equal((await v.c.get('/meeting-room/chat/general')).status, 403);
  assert.match((await adm.john.get('/admin/people/' + v.id)).text, /PRIVATE-REASON-XYZ/);
  // a declined person can not slip back into the waiting list by retesting
  await H.takeTest(v.c, 40, 10); assert.equal(user(v.id).status, 'declined');
});

test('interest list: cannot be approved until an admin assigns a supported country', async () => {
  const c = app.client(); await H.signUp(c, { email: 'ilist@example.test', country: "My country isn't listed" });
  const id = app.db.prepare('SELECT id FROM users WHERE email=?').get('ilist@example.test').id;
  await adm.john.post(`/admin/pending/${id}/approve`, { country: 'Nigeria', department: 'Technology' });
  assert.equal(user(id).status, 'interest');
  assert.match((await adm.john.get('/admin/people?status=interest')).text, /ilist@example.test/);
  await adm.john.post(`/admin/people/${id}/assign-country`, { country: 'Nigeria' });
  assert.equal(user(id).status, 'applicant'); assert.equal(user(id).country_chosen, 'Nigeria');
  await H.takeTest(c, 40, 10); assert.equal(user(id).status, 'waiting');
});

test('photos are private: only the owner and admins can open them', async () => {
  const a = await H.waitingVolunteer(app, { name: 'Photo Owner' });
  const b = await H.waitingVolunteer(app, { name: 'Photo Other' });
  const own = await a.c.get('/photos/' + a.id); assert.equal(own.status, 200); assert.equal(own.headers.get('content-type'), 'image/jpeg');
  assert.match(own.headers.get('cache-control'), /no-store/);
  assert.equal((await b.c.get('/photos/' + a.id)).status, 404, 'another volunteer');
  assert.equal((await app.client().get('/photos/' + a.id)).status, 404, 'signed out');
  assert.equal((await adm.abisade.get('/photos/' + a.id)).status, 200, 'admin');
  // not reachable as a static file
  const file = user(a.id).photo_file;
  for (const p of ['/static/' + file, '/photos/' + file, '/' + file, '/static/../data_local/photos/' + file]) assert.notEqual((await app.client().get(p)).headers.get('content-type'), 'image/jpeg', p);
  // EXIF/metadata is stripped: file is a re-encoded square 600x600 JPEG
  const meta = await require('sharp')(own.buf).metadata(); assert.equal(meta.width, 600); assert.equal(meta.height, 600); assert.equal(meta.exif, undefined);
});

test('ID card: unapproved people cannot open it; approved can; PNG and PDF download', async () => {
  const w = await H.waitingVolunteer(app, { name: 'Not Yet Approved' });
  for (const p of ['/meeting-room/id-card', '/meeting-room/id-card.png', '/meeting-room/id-card.pdf']) assert.equal((await w.c.get(p)).status, 403, p);
  assert.equal((await app.client().get('/meeting-room/id-card.png')).status, 302);
  const v = await H.approvedVolunteer(app, adm, { name: 'Card Holder', country: 'Nigeria', dept: 'Academy & Education' });
  const page = await v.c.get('/meeting-room/id-card'); assert.equal(page.status, 200);
  assert.match(page.text, /Download PNG/); assert.match(page.text, /Download PDF/); assert.match(page.text, new RegExp(user(v.id).volunteer_id));
  const png = await v.c.get('/meeting-room/id-card.png');
  assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png'); assert.match(png.headers.get('content-disposition'), /attachment; filename="NISMCAA-VOL-\d{4}.png"/);
  assert.deepEqual([...png.buf.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const pdf = await v.c.get('/meeting-room/id-card.pdf');
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.equal(pdf.buf.slice(0, 5).toString(), '%PDF-');
  assert.ok(pdf.buf.length > 5000);
  // someone else's card cannot be requested (the card is always the signed-in person's)
  const other = await H.approvedVolunteer(app, adm, { name: 'Other Holder' });
  const oPng = await other.c.get('/meeting-room/id-card.png'); assert.notDeepEqual(oPng.buf, png.buf);
});

test('the QR code on the card opens /verify/<ID> with the right data', async () => {
  const v = await H.approvedVolunteer(app, adm, { name: 'Qr Person', country: 'Australia', dept: 'Technology' });
  const vid = user(v.id).volunteer_id;
  const png = (await v.c.get('/meeting-room/id-card.png')).buf;
  const img = await loadImage(png);
  const cv = createCanvas(img.width, img.height); const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  const qr = jsQR(d.data, d.width, d.height);
  assert.ok(qr, 'a QR code was found on the card');
  assert.equal(qr.data, `${app.base}/verify/${vid}`);
  // follow the QR address
  const r = await app.client().get(new URL(qr.data).pathname);
  assert.equal(r.status, 200);
  assert.match(r.text, /NISMCAA ID Verification/); assert.match(r.text, /VALID/); assert.match(r.text, /Qr Person/); assert.match(r.text, /Volunteer/); assert.match(r.text, /Australia/); assert.match(r.text, /Valid until/);
  // the QR base address is one setting
  await adm.john.post('/admin/settings', { main: '', qr: 'https://nismcaa.com/id/' });
  const png2 = (await v.c.get('/meeting-room/id-card.png')).buf; const i2 = await loadImage(png2);
  const c2 = createCanvas(i2.width, i2.height); const x2 = c2.getContext('2d'); x2.drawImage(i2, 0, 0);
  assert.equal(jsQR(x2.getImageData(0, 0, i2.width, i2.height).data, i2.width, i2.height).data, `https://nismcaa.com/id/${vid}`);
  await adm.john.post('/admin/settings', { main: '', qr: '' });
});

test('verify page: only name, role, country, validity. No photo, e-mail or phone. Unknown ID = not found. ENDED and EXPIRED states.', async () => {
  const v = await H.approvedVolunteer(app, adm, { name: 'Verify Me', country: 'United States', email: 'verifyme@example.test' });
  const vid = user(v.id).volunteer_id;
  const anon = app.client();
  const ok = await anon.get('/verify/' + vid); assert.equal(ok.status, 200);
  assert.doesNotMatch(ok.text, /verifyme@example|<img[^>]*photo|\/photos\/|555 010/);
  assert.equal((await anon.get('/verify/' + vid.toLowerCase())).status, 200, 'case-insensitive');
  const nf = await anon.get('/verify/NISMCAA-VOL-9999'); assert.equal(nf.status, 404); assert.match(nf.text, /ID not found/);
  assert.equal((await anon.get('/verify/%27%3Cscript%3E')).status, 404);
  // expired
  app.db.prepare('UPDATE users SET id_expires_at=? WHERE id=?').run(new Date(Date.now() - 86400e3).toISOString(), v.id);
  assert.match((await anon.get('/verify/' + vid)).text, /verify-state EXPIRED">EXPIRED/);
  assert.match((await v.c.get('/meeting-room')).text, /ID expired/); assert.equal((await v.c.get('/meeting-room/chat/general')).status, 403);
  assert.equal((await v.c.get('/meeting-room/id-card.png')).status, 403, 'expired ID cannot be downloaded');
  // renew brings it back
  await adm.john.post(`/admin/people/${v.id}/renew`);
  assert.match((await anon.get('/verify/' + vid)).text, /verify-state VALID">VALID/);
  assert.equal((await v.c.get('/meeting-room/chat/general')).status, 200);
  // end ID
  await adm.john.post(`/admin/people/${v.id}/end-id`);
  assert.match((await anon.get('/verify/' + vid)).text, /verify-state ENDED">ENDED/);
  assert.equal((await v.c.get('/meeting-room/chat/general')).status, 403);
});

test('renew 1 year, decline renewal, end ID: all work and are logged', async () => {
  const v = await H.approvedVolunteer(app, adm, { name: 'Renewal Person', email: 'renewal@example.test' });
  const before = user(v.id);
  await adm.john.post(`/admin/people/${v.id}/renew`);
  const after = user(v.id);
  const gain = (Date.parse(after.id_expires_at) - Date.parse(before.id_expires_at)) / (365 * 24 * 3600e3);
  assert.ok(gain > 0.99 && gain < 1.01, 'renew adds one year to the end date');
  await adm.abisade.post(`/admin/people/${v.id}/decline-renewal`);
  assert.equal(user(v.id).id_status, 'renewal_declined');
  assert.equal((await v.c.get('/meeting-room/chat/general')).status, 200, 'stays valid until the end date');
  assert.match((await v.c.get('/meeting-room/id-card')).text, /Renewal has been declined/);
  await adm.john.post(`/admin/people/${v.id}/end-id`);
  assert.equal(user(v.id).id_status, 'ended'); assert.equal(user(v.id).status, 'ended');
  const kinds = app.db.prepare("SELECT kind, actor_id FROM audit_log WHERE target='renewal@example.test' ORDER BY id").all().map((x) => x.kind);
  assert.deepEqual(kinds.filter((k) => ['approve', 'renew', 'renewal_declined', 'end_id'].includes(k)), ['approve', 'renew', 'renewal_declined', 'end_id']);
  assert.ok(app.db.prepare("SELECT actor_id FROM audit_log WHERE kind='renewal_declined' ORDER BY id DESC").get().actor_id, 'who did it is logged');
  // volunteers cannot do any of it
  for (const a of ['renew', 'decline-renewal', 'end-id', 'reset-password']) assert.equal((await v.c.post(`/admin/people/${v.id}/${a}`)).status, 403);
  // an ended ID cannot be renewed
  await adm.john.post(`/admin/people/${v.id}/renew`); assert.equal(user(v.id).id_status, 'ended');
});

test('admin password reset: one-time temporary password, must change at next sign-in', async () => {
  const v = await H.approvedVolunteer(app, adm, { name: 'Reset Me', email: 'resetme@example.test', password: 'original-password-1' });
  const r = await adm.john.post(`/admin/people/${v.id}/reset-password`);
  assert.equal(r.status, 200);
  const temp = r.text.match(/user-select:all"><strong>([^<]+)</)[1];
  assert.match(temp, /^Tmp-/);
  assert.equal((await adm.john.get('/admin/people/' + v.id)).text.includes(temp), false, 'not shown again');
  assert.equal(JSON.stringify(app.db.prepare('SELECT * FROM audit_log').all()).includes(temp), false, 'not written to the log');
  assert.ok(!user(v.id).pw_hash.includes(temp));
  assert.equal((await v.c.get('/meeting-room')).status, 302, 'old sessions are ended');
  assert.equal((await H.signIn(app.client(), 'resetme@example.test', 'original-password-1')).status, 401);
  const c = app.client(); const login = await H.signIn(c, 'resetme@example.test', temp);
  assert.equal(login.status, 302); assert.equal(login.location, '/account/password');
  assert.equal((await c.get('/meeting-room')).location, '/account/password', 'blocked until changed');
  assert.equal((await c.post('/account/password', { current: temp, password: 'my-own-new-password', password2: 'my-own-new-password' })).status, 302);
  assert.equal((await c.get('/meeting-room')).status, 200);
});
