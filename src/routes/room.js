'use strict';
/** Meeting Room landing, chat, notes and the ID card. Access is checked on the server for every request. */
const path = require('path');
const { now, audit, getSetting } = require('../db');
const { COUNTRIES, slug } = require('../config');
const { idState, hasRoomAccess, isAdmin } = require('../access');
const { meetingsFor } = require('../meetings');
const access = require('../access');
const { renderCardPng, pngToPdf } = require('../idcard');

const COUNTRY_BY_SLUG = Object.fromEntries(COUNTRIES.map((c) => [slug(c), c]));
const fmtLong = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));

module.exports = function (app, ctx) {
  const { db, config } = ctx;

  const needLogin = (req, res, next) => (req.user ? next() : res.redirect('/sign-in?next=' + encodeURIComponent(req.originalUrl.split('?')[0])));
  /** Gate for everything inside the Meeting Room. */
  const needRoom = (req, res, next) => {
    if (!req.user) return res.redirect('/sign-in?next=' + encodeURIComponent(req.originalUrl.split('?')[0]));
    if (!hasRoomAccess(req.user)) return res.status(403).render('error', { title: 'No access yet', message: 'The Meeting Room is only for approved volunteers and administrators. Open the Meeting Room page to see your status.' });
    res.locals.mainTab = 'room';
    next();
  };
  ctx.needLogin = needLogin; ctx.needRoom = needRoom;

  function callLinkFor(user, countryOverride) {
    const country = countryOverride || user.country;
    const c = country ? db.prepare('SELECT url FROM country_links WHERE country=?').get(country) : null;
    return (c && c.url) || getSetting(db, 'call_link_main') || '';
  }

  // ---------------- landing ----------------
  app.get('/meeting-room', needLogin, (req, res) => {
    const u = req.user;
    if (access.isGuest(u)) return res.redirect('/guest'); // sponsors and vendors have their own, simpler page
    if (!hasRoomAccess(u)) return res.render('room-status', { title: 'Meeting Room', state: idState(u) });
    res.locals.mainTab = 'room';
    const links = isAdmin(u) ? COUNTRIES.map((c) => ({ country: c, url: callLinkFor(u, c) })).filter((l) => l.url) : [];
    res.render('room', { title: 'Meeting Room', scheduled: meetingsFor(db, u, access).upcoming, callLink: isAdmin(u) ? getSetting(db, 'call_link_main') : callLinkFor(u), links });
  });

  // ---------------- chat ----------------
  const roomName = (key) => (key === 'general' ? "Organizers' general chat" : (COUNTRY_BY_SLUG[key] ? COUNTRY_BY_SLUG[key] + ' room' : null));
  function canChat(u, key) {
    if (!hasRoomAccess(u)) return false;
    if (key === 'general') return true;
    const country = COUNTRY_BY_SLUG[key];
    if (!country) return false;
    return isAdmin(u) || u.country === country;
  }
  const chatRooms = (u) => [{ key: 'general', name: "Organizers' general chat" }, ...COUNTRIES.filter((c) => isAdmin(u) || u.country === c).map((c) => ({ key: slug(c), name: c }))];

  const dbKey = (key) => (key === 'general' ? 'general' : 'c:' + COUNTRY_BY_SLUG[key]);
  function listMessages(key) {
    return db.prepare(`SELECT m.id, m.body, m.created_at, m.deleted_at, u.name, u.role FROM messages m JOIN users u ON u.id=m.user_id
      WHERE m.room=? ORDER BY m.id DESC LIMIT 100`).all(dbKey(key)).reverse();
  }
  const shape = (m) => ({ id: m.id, name: m.name, admin: m.role === 'admin', time: new Intl.DateTimeFormat('en-US', { timeZone: config.displayTz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(m.created_at)), deleted: !!m.deleted_at, body: m.deleted_at ? '' : m.body });

  app.get('/meeting-room/chat', needRoom, (req, res) => res.redirect('/meeting-room/chat/general'));
  app.get('/meeting-room/chat/:room', needRoom, (req, res) => {
    const key = req.params.room;
    if (!roomName(key)) return res.status(404).render('error', { title: 'Not found', message: 'No such chat room.' });
    if (!canChat(req.user, key)) return res.status(403).render('error', { title: 'No access', message: 'You can only open the general chat and your own country room.' });
    res.render('chat', { title: roomName(key), key, name: roomName(key), rooms: chatRooms(req.user), messages: listMessages(key).map(shape) });
  });
  app.get('/meeting-room/chat/:room/messages', needRoom, (req, res) => {
    const key = req.params.room;
    if (!roomName(key) || !canChat(req.user, key)) return res.status(403).json({ error: 'no access' });
    res.set('Cache-Control', 'no-store');
    res.json({ messages: listMessages(key).map(shape) });
  });
  app.post('/meeting-room/chat/:room', needRoom, (req, res) => {
    const key = req.params.room; const wantsJson = (req.headers.accept || '').includes('application/json');
    if (!roomName(key) || !canChat(req.user, key)) return res.status(403).json({ error: 'no access' });
    const body = String(req.body.body || '').trim().slice(0, 1000);
    const since = new Date(Date.now() - 10000).toISOString();
    const recent = db.prepare('SELECT COUNT(*) c FROM messages WHERE user_id=? AND created_at>?').get(req.user.id, since).c;
    if (recent >= 5) {
      if (wantsJson) return res.status(429).json({ error: 'You can send 5 messages every 10 seconds. Please wait a moment.' });
      req.flash('err', 'You can send 5 messages every 10 seconds. Please wait a moment.'); return res.redirect('/meeting-room/chat/' + key);
    }
    if (!body) return wantsJson ? res.status(400).json({ error: 'empty' }) : res.redirect('/meeting-room/chat/' + key);
    db.prepare('INSERT INTO messages(room,user_id,body,created_at) VALUES (?,?,?,?)').run(dbKey(key), req.user.id, body, now());
    if (wantsJson) return res.json({ ok: true });
    res.redirect('/meeting-room/chat/' + key);
  });
  app.post('/meeting-room/chat/:room/delete/:id', needRoom, (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).render('error', { title: 'Admins only', message: 'Only administrators can delete messages.' });
    const key = req.params.room;
    if (!roomName(key)) return res.redirect('/meeting-room');
    const m = db.prepare('SELECT m.*, u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=? AND m.room=?').get(Number(req.params.id), dbKey(key));
    if (m && !m.deleted_at) {
      db.prepare('UPDATE messages SET deleted_at=?, deleted_by=? WHERE id=?').run(now(), req.user.id, m.id);
      audit(db, 'chat_delete', req.user.id, `${dbKey(key)} #${m.id}`, `message by ${m.name}: ${m.body.slice(0, 200)}`);
    }
    res.redirect('/meeting-room/chat/' + key);
  });

  // ---------------- notes ----------------
  app.get('/meeting-room/notes', needRoom, (req, res) => {
    const u = req.user;
    const rows = isAdmin(u)
      ? db.prepare('SELECT n.*, x.name author FROM notes n JOIN users x ON x.id=n.user_id ORDER BY n.note_date DESC, n.id DESC').all()
      : db.prepare(`SELECT n.*, x.name author FROM notes n JOIN users x ON x.id=n.user_id
          WHERE n.user_id=? OR (n.visibility='country' AND n.country=?) ORDER BY n.note_date DESC, n.id DESC`).all(u.id, u.country);
    res.render('notes', { title: 'Meeting notes', rows, today: ctx.todayStr(), errors: [] });
  });
  app.post('/meeting-room/notes', needRoom, (req, res) => {
    const u = req.user; const b = req.body;
    const title = String(b.title || '').trim().slice(0, 120); const text = String(b.text || '').trim().slice(0, 8000);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.note_date || '') ? b.note_date : ctx.todayStr();
    const vis = b.visibility === 'country' ? 'country' : 'private';
    let country = u.country;
    if (isAdmin(u) && vis === 'country') country = COUNTRIES.includes(b.country) ? b.country : null;
    if (!title || !text || (vis === 'country' && !country)) { req.flash('err', 'Please give the note a title and some text' + (vis === 'country' ? ' and choose a country to share with.' : '.')); return res.redirect('/meeting-room/notes'); }
    db.prepare('INSERT INTO notes(user_id,country,title,note_date,body,visibility,created_at) VALUES (?,?,?,?,?,?,?)').run(u.id, country, title, date, text, vis, now());
    req.flash('ok', 'Note saved.'); res.redirect('/meeting-room/notes');
  });
  app.post('/meeting-room/notes/:id/delete', needRoom, (req, res) => {
    const n = db.prepare('SELECT * FROM notes WHERE id=?').get(Number(req.params.id));
    if (n && (n.user_id === req.user.id || isAdmin(req.user))) { db.prepare('DELETE FROM notes WHERE id=?').run(n.id); if (n.user_id !== req.user.id) audit(db, 'note_delete', req.user.id, `note #${n.id}`, n.title); }
    res.redirect('/meeting-room/notes');
  });

  // ---------------- ID card ----------------
  const needCard = (req, res, next) => {
    const u = req.user;
    if (!u) return res.redirect('/sign-in?next=/meeting-room/id-card');
    if (u.role === 'admin' || !u.volunteer_id || u.status === 'ended' || u.id_status === 'ended') return res.status(403).render('error', { title: 'No ID card', message: 'An ID card is only available to approved volunteers with a current ID.' });
    next();
  };
  async function cardData(req) {
    const u = req.user;
    const base = getSetting(db, 'qr_base_url') || (config.publicUrl ? config.publicUrl + '/verify/' : `${req.protocol}://${req.get('host')}/verify/`);
    return {
      name: u.name, country: u.country, department: u.department, volunteerId: u.volunteer_id,
      issuedAt: fmtLong(u.id_issued_at), expiresAt: fmtLong(u.id_expires_at), state: idState(u),
      photoPath: path.join(config.dataDir, 'photos', path.basename(u.photo_file || 'x')), verifyUrl: base + u.volunteer_id,
    };
  }
  app.get('/meeting-room/id-card', needCard, (req, res) => {
    res.locals.mainTab = 'room';
    res.render('id-card', { title: 'My ID card', state: idState(req.user), issued: req.user.id_issued_at, expires: req.user.id_expires_at, renewalDeclined: req.user.id_status === 'renewal_declined' });
  });
  app.get('/meeting-room/id-card.png', needCard, async (req, res) => {
    if (idState(req.user) !== 'VALID') return res.status(403).render('error', { title: 'ID not valid', message: 'This ID is no longer valid, so it cannot be downloaded.' });
    const png = await renderCardPng(await cardData(req));
    res.set({ 'Content-Type': 'image/png', 'Content-Disposition': `${req.query.view ? 'inline' : 'attachment'}; filename="${req.user.volunteer_id}.png"`, 'Cache-Control': 'private, no-store' });
    res.send(png);
  });
  app.get('/meeting-room/id-card.pdf', needCard, async (req, res) => {
    if (idState(req.user) !== 'VALID') return res.status(403).render('error', { title: 'ID not valid', message: 'This ID is no longer valid, so it cannot be downloaded.' });
    const pdf = await pngToPdf(await renderCardPng(await cardData(req)));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${req.user.volunteer_id}.pdf"`, 'Cache-Control': 'private, no-store' });
    res.send(pdf);
  });
};

module.exports.COUNTRY_BY_SLUG = COUNTRY_BY_SLUG;
