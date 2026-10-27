'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let app, adm, us, ng, us2, waiting, declined;
before(async () => {
  app = await H.startApp(); app.setFakeKey(); adm = await H.admins(app);
  us = await H.approvedVolunteer(app, adm, { name: 'Us Volunteer', country: 'United States', dept: 'Technology' });
  us2 = await H.approvedVolunteer(app, adm, { name: 'Us Second', country: 'United States', dept: 'Finance & Admin' });
  ng = await H.approvedVolunteer(app, adm, { name: 'Ng Volunteer', country: 'Nigeria', dept: 'Technology' });
  waiting = await H.waitingVolunteer(app, { name: 'Waiting Person' });
  declined = await H.waitingVolunteer(app, { name: 'Declined Person' });
  await adm.john.post(`/admin/pending/${declined.id}/decline`, { reason: 'test' });
});
after(async () => { await app.close(); });

const msgs = async (c, room) => (await c.get(`/meeting-room/chat/${room}/messages`));
const send = (c, room, body) => c.postJson(`/meeting-room/chat/${room}`, { body });

test('a US volunteer opens the US room but not the Nigeria room (even by typing the address), and the reverse', async () => {
  assert.equal((await us.c.get('/meeting-room/chat/united-states')).status, 200);
  assert.equal((await us.c.get('/meeting-room/chat/nigeria')).status, 403);
  assert.equal((await msgs(us.c, 'nigeria')).status, 403);
  assert.equal((await send(us.c, 'nigeria', 'hello from the wrong room')).status, 403);
  assert.equal((await ng.c.get('/meeting-room/chat/nigeria')).status, 200);
  assert.equal((await ng.c.get('/meeting-room/chat/united-states')).status, 403);
  assert.equal((await msgs(ng.c, 'united-states')).status, 403);
  assert.equal((await us.c.get('/meeting-room/chat/atlantis')).status, 404);
  // the room tabs only list what you may open
  const page = (await us.c.get('/meeting-room/chat/general')).text;
  assert.match(page, /\/meeting-room\/chat\/united-states/); assert.doesNotMatch(page, /\/meeting-room\/chat\/nigeria/);
  assert.equal(app.db.prepare("SELECT COUNT(*) c FROM messages WHERE body LIKE 'hello from the wrong room'").get().c, 0);
});

test('country room messages stay in their country; admins see every room; the general chat works for everyone approved', async () => {
  assert.equal((await send(us.c, 'united-states', 'US-ONLY-MESSAGE')).status, 200);
  assert.equal((await send(ng.c, 'nigeria', 'NG-ONLY-MESSAGE')).status, 200);
  assert.match((await us2.c.get('/meeting-room/chat/united-states')).text, /US-ONLY-MESSAGE/);
  assert.doesNotMatch((await us2.c.get('/meeting-room/chat/united-states')).text, /NG-ONLY-MESSAGE/);
  const j = JSON.parse((await msgs(us.c, 'united-states')).text); assert.ok(j.messages.some((m) => m.body === 'US-ONLY-MESSAGE' && m.name === 'Us Volunteer'));
  assert.ok(j.messages[0].time && j.messages[0].name);
  // admins: all rooms
  for (const room of ['general', 'united-states', 'nigeria', 'canada', 'united-arab-emirates', 'united-kingdom', 'australia']) assert.equal((await adm.john.get('/meeting-room/chat/' + room)).status, 200, room);
  assert.match((await adm.abisade.get('/meeting-room/chat/nigeria')).text, /NG-ONLY-MESSAGE/);
  assert.equal((await send(adm.john, 'nigeria', 'Admin says hi')).status, 200);
  assert.match((await ng.c.get('/meeting-room/chat/nigeria')).text, /Admin says hi/);
  // general: everyone approved can post and read
  await send(us.c, 'general', 'GENERAL-FROM-US'); await send(ng.c, 'general', 'GENERAL-FROM-NG');
  for (const c of [us.c, ng.c, us2.c, adm.john.constructor && adm.john]) { const t = (await c.get('/meeting-room/chat/general')).text; assert.match(t, /GENERAL-FROM-US/); assert.match(t, /GENERAL-FROM-NG/); }
});

test('an unapproved, waiting or declined person is blocked everywhere in the Meeting Room; so is a signed-out visitor', async () => {
  const urls = ['/meeting-room/chat/general', '/meeting-room/chat/united-states', '/meeting-room/notes', '/meeting-room/plan', '/meeting-room/plan/nigeria/all', '/meeting-room/plan/about'];
  for (const who of [waiting.c, declined.c]) for (const u of urls) assert.equal((await who.get(u)).status, 403, u);
  assert.equal((await send(waiting.c, 'general', 'let me in')).status, 403);
  assert.equal((await waiting.c.post('/meeting-room/notes', { title: 't', text: 'x' })).status, 403);
  for (const u of urls) assert.equal((await app.client().get(u)).status, 302, u);
  const room = (await waiting.c.get('/meeting-room')).text; assert.doesNotMatch(room, /Join call|Open chat/);
});

test('chat is text only, escapes HTML, limits 5 messages per 10 seconds, and admins can delete (logged)', async () => {
  const c = us2.c;
  assert.equal((await send(c, 'united-states', '<script>alert(1)</script> <b>x</b>')).status, 200);
  const html = (await c.get('/meeting-room/chat/united-states')).text;
  assert.ok(!html.includes('<script>alert(1)</script>')); assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // rate limit: we have already sent 1 in this window; 4 more are allowed, the 6th is refused
  const codes = []; for (let i = 0; i < 6; i++) codes.push((await send(c, 'united-states', 'burst ' + i)).status);
  assert.deepEqual(codes.slice(0, 4), [200, 200, 200, 200]); assert.equal(codes[4], 429); assert.equal(codes[5], 429);
  assert.equal(app.db.prepare("SELECT COUNT(*) c FROM messages WHERE body='burst 4' OR body='burst 5'").get().c, 0);
  // after 10 seconds it works again
  app.db.prepare('UPDATE messages SET created_at=? WHERE user_id=?').run(new Date(Date.now() - 20000).toISOString(), us2.id);
  assert.equal((await send(c, 'united-states', 'later message')).status, 200);
  // delete: admins only
  const m = app.db.prepare("SELECT id FROM messages WHERE body='US-ONLY-MESSAGE'").get();
  assert.equal((await us.c.post(`/meeting-room/chat/united-states/delete/${m.id}`)).status, 403);
  assert.equal(app.db.prepare('SELECT deleted_at FROM messages WHERE id=?').get(m.id).deleted_at, null);
  assert.equal((await adm.john.post(`/meeting-room/chat/united-states/delete/${m.id}`)).status, 302);
  assert.ok(app.db.prepare('SELECT deleted_at FROM messages WHERE id=?').get(m.id).deleted_at);
  const after = JSON.parse((await msgs(us.c, 'united-states')).text);
  assert.ok(!JSON.stringify(after).includes('US-ONLY-MESSAGE')); assert.ok(after.messages.find((x) => x.id === m.id).deleted);
  const log = app.db.prepare("SELECT * FROM audit_log WHERE kind='chat_delete' ORDER BY id DESC").get();
  assert.match(log.detail, /Us Volunteer/); assert.ok(log.actor_id);
  // a message id from another room cannot be deleted through this room's URL
  const ngMsg = app.db.prepare("SELECT id FROM messages WHERE body='NG-ONLY-MESSAGE'").get();
  await adm.john.post(`/meeting-room/chat/united-states/delete/${ngMsg.id}`);
  assert.equal(app.db.prepare('SELECT deleted_at FROM messages WHERE id=?').get(ngMsg.id).deleted_at, null);
});

test('Join call link: volunteers cannot edit it; the admin edits it and the button follows; country link overrides', async () => {
  assert.match((await us.c.get('/meeting-room')).text, /The call link has not been set yet/);
  assert.equal((await us.c.post('/admin/settings', { main: 'https://evil.example/x' })).status, 403);
  assert.equal((await us.c.get('/admin/settings')).status, 403);
  const bad = await adm.john.post('/admin/settings', { main: 'javascript:alert(1)' });
  assert.equal(bad.status, 302); assert.match((await adm.john.get('/admin/settings')).text, /must start with https/);
  await adm.john.post('/admin/settings', { main: 'https://meet.google.com/aaa-test-main' });
  const btn = (t) => t.match(/<a class="btn gold" href="([^"]+)" target="_blank" rel="noopener noreferrer">Join call/);
  assert.equal(btn((await us.c.get('/meeting-room')).text)[1], 'https://meet.google.com/aaa-test-main');
  assert.equal(btn((await ng.c.get('/meeting-room')).text)[1], 'https://meet.google.com/aaa-test-main');
  await adm.john.post('/admin/settings', { main: 'https://meet.google.com/aaa-test-main', link_Nigeria: 'https://meet.jit.si/nismcaa-nigeria-test' });
  assert.equal(btn((await ng.c.get('/meeting-room')).text)[1], 'https://meet.jit.si/nismcaa-nigeria-test');
  assert.equal(btn((await us.c.get('/meeting-room')).text)[1], 'https://meet.google.com/aaa-test-main');
  assert.equal(btn((await adm.john.get('/meeting-room')).text)[1], 'https://meet.google.com/aaa-test-main');
});

test('notes: private notes are not visible to others; shared notes only to the same country; admins see all', async () => {
  await us.c.post('/meeting-room/notes', { title: 'US private', text: 'PRIVATE-US-TEXT', visibility: 'private', note_date: '2026-10-27' });
  await us.c.post('/meeting-room/notes', { title: 'US shared', text: 'SHARED-US-TEXT', visibility: 'country', note_date: '2026-10-27' });
  await ng.c.post('/meeting-room/notes', { title: 'NG shared', text: 'SHARED-NG-TEXT', visibility: 'country' });
  const usOther = (await us2.c.get('/meeting-room/notes')).text;
  assert.match(usOther, /SHARED-US-TEXT/); assert.doesNotMatch(usOther, /PRIVATE-US-TEXT/); assert.doesNotMatch(usOther, /SHARED-NG-TEXT/);
  const ngSee = (await ng.c.get('/meeting-room/notes')).text;
  assert.match(ngSee, /SHARED-NG-TEXT/); assert.doesNotMatch(ngSee, /SHARED-US-TEXT/); assert.doesNotMatch(ngSee, /PRIVATE-US-TEXT/);
  const own = (await us.c.get('/meeting-room/notes')).text; assert.match(own, /PRIVATE-US-TEXT/); assert.match(own, /SHARED-US-TEXT/);
  const adminSees = (await adm.abisade.get('/meeting-room/notes')).text;
  for (const t of ['PRIVATE-US-TEXT', 'SHARED-US-TEXT', 'SHARED-NG-TEXT']) assert.match(adminSees, new RegExp(t));
  // only the author (or an admin) can delete
  const n = app.db.prepare("SELECT id FROM notes WHERE title='US shared'").get();
  await ng.c.post(`/meeting-room/notes/${n.id}/delete`); assert.ok(app.db.prepare('SELECT 1 FROM notes WHERE id=?').get(n.id));
  await us.c.post(`/meeting-room/notes/${n.id}/delete`); assert.equal(app.db.prepare('SELECT 1 FROM notes WHERE id=?').get(n.id), undefined);
  // notes are typed by hand: the page has no transcript/summary button or form
  assert.doesNotMatch((await us.c.get('/meeting-room/notes')).text, /<button[^>]*>[^<]*(transcribe|summarize)/i);
});

test('no file upload control anywhere in the Meeting Room (chat/notes/plan/admin pages)', async () => {
  const pages = ['/meeting-room', '/meeting-room/chat/general', '/meeting-room/chat/nigeria', '/meeting-room/notes', '/meeting-room/plan/nigeria/all', '/meeting-room/plan/nigeria/technology', '/meeting-room/plan/about', '/meeting-room/id-card'];
  for (const p of pages) for (const c of [ng.c, adm.john]) {
    const r = await c.get(p); if (r.status !== 200) continue;
    assert.doesNotMatch(r.text, /type="file"|enctype="multipart/i, p);
  }
  for (const p of ['/admin', '/admin/pending', '/admin/people', '/admin/key', '/admin/settings', '/admin/heads', '/admin/log']) { const r = await adm.john.get(p); assert.doesNotMatch(r.text, /type="file"|multipart/i, p); }
  // the only upload anywhere is the sign-up photo
  assert.match((await app.client().get('/sign-up')).text, /type="file"/);
});

test('mobile friendly: viewport tag and responsive stylesheet on every page', async () => {
  for (const p of ['/', '/sign-up', '/sign-in', '/course', '/meeting-room', '/verify/NISMCAA-VOL-0001']) assert.match((await (p === '/meeting-room' ? us.c : app.client()).get(p)).text, /<meta name="viewport" content="width=device-width, initial-scale=1">/, p);
  const css = (await app.client().get('/static/style.css')).text; assert.match(css, /@media \(max-width:720px\)/); assert.match(css, /overflow-x:auto/);
});
