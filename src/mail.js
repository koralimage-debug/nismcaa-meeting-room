'use strict';
/** First-party Zoho SMTP helper (same method as the other NISMCAA sites).
 *  Uses ZOHO_SMTP_USER / ZOHO_SMTP_PASSWORD. Never logs or prints the password.
 *  If settings are missing, sending is skipped and a line is logged; callers are not thrown.
 *  Tests may inject a fake transport with _setTransport so no real message is sent.
 */
const tls = require('tls');
const crypto = require('crypto');

const INFO = 'info@nismcaa.com';
const DEFAULT_HOST = 'smtp.zoho.com';
const DEFAULT_PORT = 465;
const DEFAULT_PUBLIC = 'https://meeting.nismcaa.com';

const isEmail = (e) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(e || '')) && String(e).length <= 254;

function host() { return String(process.env.ZOHO_SMTP_HOST || DEFAULT_HOST).trim() || DEFAULT_HOST; }
function port() { return Number(process.env.ZOHO_SMTP_PORT) || DEFAULT_PORT; }
function user() { return String(process.env.ZOHO_SMTP_USER || '').trim(); }
function pass() { return String(process.env.ZOHO_SMTP_PASSWORD || '').trim(); }
function configured() { return !!(user() && pass()); }
function notifyTo() {
  const t = String(process.env.ADMIN_NOTIFY_EMAIL || INFO).trim().toLowerCase();
  return isEmail(t) ? t : INFO;
}

let transport = null;
let pending = [];
let settings = { quiet: false, publicUrl: '', displayTz: 'America/New_York' };

function configure(opts) { settings = { ...settings, ...(opts || {}) }; }
function _setTransport(t) { transport = t; }
function _reset() { transport = null; pending = []; }

function logLine(msg) {
  if (settings.quiet) return;
  console.warn(msg);
}

function publicBase() {
  const u = settings.publicUrl || process.env.PUBLIC_URL || DEFAULT_PUBLIC;
  return String(u).replace(/\/+$/, '') || DEFAULT_PUBLIC;
}

function formatWhen(iso, tz) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || settings.displayTz || 'America/New_York',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);
}

function buildPassMessage({ name, country, score, child, when, approvalUrl }) {
  const subject = 'A volunteer has passed the course: ' + name;
  const text = [
    'A volunteer has passed the NISMCAA Meeting Room course and is waiting for your approval.',
    '',
    'Name: ' + name,
    'Country: ' + country,
    'Score: ' + score + '/50',
    'Child-protection score: ' + child + '/10',
    'Date: ' + when,
    '',
    'Review them here (Waiting for approval):',
    approvalUrl,
    '',
    'This message was sent automatically by the NISMCAA Meeting Room.',
    '',
  ].join('\n');
  return { subject, text };
}

function encHeader(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

function buildMime({ from, to, subject, text }) {
  const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    'From: NISMCAA Meeting Room <' + from + '>',
    'To: <' + to + '>',
    'Reply-To: ' + INFO,
    'Subject: ' + encHeader(String(subject).replace(/[\r\n]+/g, ' ')),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@nismcaa.com>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    '',
    body,
    '',
  ].join('\r\n');
}

function talk(steps) {
  return new Promise((ok, ko) => {
    const h = host();
    const s = tls.connect({ host: h, port: port(), servername: h, timeout: 20000 });
    let buf = '', i = 0;
    const fail = (e) => { try { s.destroy(); } catch (_) {} ko(e); };
    s.setEncoding('utf8');
    s.on('error', fail);
    s.on('timeout', () => fail(new Error('SMTP timeout')));
    s.on('data', (c) => {
      buf += c;
      const L = buf.split(/\r?\n/);
      buf = L.pop() || '';
      for (const line of L) {
        if (!/^\d{3} /.test(line)) continue;
        const code = +line.slice(0, 3), st = steps[i];
        if (!st) return;
        if (code !== st.expect) return fail(new Error('SMTP ' + code + ' at ' + st.label));
        if (st.write) s.write(st.write);
        i++;
        if (i >= steps.length) { try { s.end(); } catch (_) {} return ok(); }
      }
    });
    s.on('end', () => { if (i < steps.length) fail(new Error('SMTP closed early')); });
  });
}

async function sendFrom(from, to, subject, text) {
  const b64 = (x) => Buffer.from(x, 'utf8').toString('base64') + '\r\n';
  const msg = buildMime({ from, to, subject, text }).replace(/\r\n\./g, '\r\n..') + '.\r\n';
  await talk([
    { expect: 220, write: 'EHLO nismcaa.com\r\n', label: 'banner' },
    { expect: 250, write: 'AUTH LOGIN\r\n', label: 'ehlo' },
    { expect: 334, write: b64(user()), label: 'auth' },
    { expect: 334, write: b64(pass()), label: 'user' },
    { expect: 235, write: 'MAIL FROM:<' + from + '>\r\n', label: 'login' },
    { expect: 250, write: 'RCPT TO:<' + to + '>\r\n', label: 'from' },
    { expect: 250, write: 'DATA\r\n', label: 'rcpt' },
    { expect: 354, write: msg, label: 'data' },
    { expect: 250, write: 'QUIT\r\n', label: 'body' },
    { expect: 221, write: '', label: 'quit' },
  ]);
}

async function send({ to, subject, text }) {
  if (transport) return transport({ to, subject, text });
  if (!configured()) return { ok: false, skipped: true, error: 'mail is not configured' };
  if (process.env.NODE_TEST_CONTEXT) return { ok: false, skipped: true, error: 'no fake transport in tests' };
  if (!isEmail(to)) return { ok: false, error: 'invalid address' };
  try {
    await sendFrom(INFO, to, subject, text);
    return { ok: true, from: INFO, to };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 120) };
  }
}

async function notifyPassed(db, userId, g, whenIso) {
  try {
    const u = db.prepare('SELECT name, country_chosen, country FROM users WHERE id=?').get(userId);
    const msg = buildPassMessage({
      name: (u && u.name) || 'Volunteer',
      country: (u && (u.country_chosen || u.country)) || 'Not listed',
      score: g && g.score,
      child: g && g.child,
      when: formatWhen(whenIso || new Date().toISOString()),
      approvalUrl: publicBase() + '/admin/pending',
    });
    if (!transport && !configured()) {
      logLine('pass-email skipped: mail is not configured');
      return { ok: false, skipped: true };
    }
    const r = await send({ to: notifyTo(), subject: msg.subject, text: msg.text });
    if (r && r.skipped) logLine('pass-email skipped: mail is not configured');
    else if (r && r.ok === false) logLine('pass-email error: ' + (r.error || 'send failed'));
    return r;
  } catch (e) {
    logLine('pass-email error: ' + String(e && e.message || e).slice(0, 120));
    return { ok: false, error: String(e && e.message || e).slice(0, 120) };
  }
}

function queuePassEmail(db, userId, g, whenIso) {
  const p = Promise.resolve().then(() => notifyPassed(db, userId, g, whenIso));
  pending.push(p);
  p.catch(() => {});
  return p;
}

async function flush() {
  const batch = pending.splice(0, pending.length);
  if (!batch.length) return [];
  return Promise.all(batch);
}

module.exports = {
  INFO, configured, configure, send, notifyPassed, queuePassEmail, flush,
  buildPassMessage, formatWhen, notifyTo, publicBase, isEmail,
  _setTransport, _reset,
};
