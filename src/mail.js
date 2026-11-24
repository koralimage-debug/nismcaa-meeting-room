'use strict';
/** First-party Zoho SMTP helper (same method as the other NISMCAA sites).
 *  Uses ZOHO_SMTP_USER / ZOHO_SMTP_PASSWORD. Never logs or prints the password.
 *  If settings are missing, sending is skipped and a line is logged; callers are not thrown.
 *  Tests may inject a fake transport with _setTransport so no real message is sent.
 */
const tls = require('tls');
const crypto = require('crypto');

const INFO = 'info@nismcaa.com';
// Paid Zoho organization accounts on a custom domain (info@nismcaa.com) use smtppro.zoho.com.
// Personal/free Zoho Mail uses smtp.zoho.com. Override with ZOHO_SMTP_HOST if needed.
const DEFAULT_HOST = 'smtppro.zoho.com';
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

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildPassMessage({ name, email, country, score, child, when, approvalUrl }) {
  const subject = 'Please review: ' + name + ' passed the Meeting Room course';
  const text = [
    'A volunteer has passed the NISMCAA Meeting Room course and is waiting for your approval.',
    '',
    'Name: ' + name,
    'E-mail: ' + (email || ''),
    'Country: ' + country,
    'Score: ' + score + '/50 (pass mark is 40/50)',
    'Child-protection score: ' + child + '/10 (pass mark is 9/10)',
    'Date and time: ' + when,
    '',
    'Please review and approve this volunteer here:',
    approvalUrl,
    '',
    'This message was sent automatically by the NISMCAA Meeting Room.',
    '',
  ].join('\n');
  const row = (label, value) => '<tr><td style="padding:6px 12px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#5a6478;vertical-align:top;white-space:nowrap;">' + label + '</td><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#0B2559;font-weight:600;">' + value + '</td></tr>';
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#0B2559;">A volunteer has passed the course</h1>
    <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#0B2559;">A volunteer has passed the NISMCAA Meeting Room course and is waiting for your approval.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
      ${row('Name', esc(name))}
      ${row('E-mail', esc(email || ''))}
      ${row('Country', esc(country))}
      ${row('Score', esc(score) + '/50 (pass mark is 40/50)')}
      ${row('Child-protection score', esc(child) + '/10 (pass mark is 9/10)')}
      ${row('Date and time', esc(when))}
    </table>
    <p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#0B2559;">Please review and approve this volunteer here:</p>
    ${goldButton(approvalUrl, 'Review and approve')}
    <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#5a6478;">If the button does not open, copy and paste this link into your browser:<br><a href="${esc(approvalUrl)}" style="color:#13347a;word-break:break-all;">${esc(approvalUrl)}</a></p>
  `;
  return {
    subject,
    text,
    html: emailShell({
      title: subject,
      preheader: name + ' passed the course and is waiting for your approval.',
      bodyHtml,
      footerNote: 'This message was sent automatically by the NISMCAA Meeting Room.',
    }),
  };
}

function encHeader(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

function b64body(s) {
  return Buffer.from(String(s).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
}

function commonHeaders(from, to, subject) {
  return [
    'From: NISMCAA Meeting Room <' + from + '>',
    'To: <' + to + '>',
    'Reply-To: ' + INFO,
    'Subject: ' + encHeader(String(subject).replace(/[\r\n]+/g, ' ')),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@nismcaa.com>',
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
  ];
}

function buildMime({ from, to, subject, text, html }) {
  if (!html) {
    return commonHeaders(from, to, subject).concat([
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64body(text),
      '',
    ]).join('\r\n');
  }
  const boundary = 'nmr' + crypto.randomBytes(12).toString('hex');
  return commonHeaders(from, to, subject).concat([
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64body(text),
    '--' + boundary,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64body(html),
    '--' + boundary + '--',
    '',
  ]).join('\r\n');
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

async function sendFrom(from, to, subject, text, html) {
  const b64 = (x) => Buffer.from(x, 'utf8').toString('base64') + '\r\n';
  const msg = buildMime({ from, to, subject, text, html }).replace(/\r\n\./g, '\r\n..') + '.\r\n';
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

async function send({ to, subject, text, html }) {
  if (transport) return transport({ to, subject, text, html });
  if (!configured()) return { ok: false, skipped: true, error: 'mail is not configured' };
  if (process.env.NODE_TEST_CONTEXT) return { ok: false, skipped: true, error: 'no fake transport in tests' };
  if (!isEmail(to)) return { ok: false, error: 'invalid address' };
  try {
    await sendFrom(INFO, to, subject, text, html);
    return { ok: true, from: INFO, to };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 120) };
  }
}

async function notifyPassed(db, userId, g, whenIso) {
  try {
    const u = db.prepare('SELECT name, email, country_chosen, country FROM users WHERE id=?').get(userId);
    const msg = buildPassMessage({
      name: (u && u.name) || 'Volunteer',
      email: (u && u.email) || '',
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
    const r = await send({ to: notifyTo(), subject: msg.subject, text: msg.text, html: msg.html });
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


function firstName(name) {
  const n = String(name || '').trim();
  return n ? n.split(/\s+/)[0] : 'there';
}

function emailShell({ title, preheader, bodyHtml, footerNote }) {
  const logo = publicBase() + '/static/img/logo.png';
  const note = footerNote || 'This message was sent by the NISMCAA Meeting Room.';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#071a40;color:#0B2559;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#071a40;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#071a40;margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:28px 12px 36px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:100%;background:#FBF7EC;border-radius:18px;overflow:hidden;">
          <tr>
            <td align="center" style="background:#071a40;padding:28px 24px 22px;border-bottom:4px solid #C9A227;">
              <img src="${logo}" width="72" height="72" alt="NISMCAA" style="display:block;border:0;background:transparent;width:72px;height:72px;">
              <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:.14em;color:#EBCB63;text-transform:uppercase;">NISMCAA</p>
              <p style="margin:4px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#FBF7EC;letter-spacing:.02em;">Meeting Room</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 16px;font-family:Georgia,'Times New Roman',serif;color:#0B2559;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#5a6478;">
              <p style="margin:0 0 8px;">${note}</p>
              <p style="margin:0;">info@nismcaa.com &middot; (470) 684-4463</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return html;
}

function goldButton(href, label) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px;">
    <tr>
      <td align="center" bgcolor="#C9A227" style="background:#C9A227;background-image:linear-gradient(135deg,#EBCB63,#C9A227);border-radius:12px;">
        <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:Georgia,'Times New Roman',serif;font-size:16px;font-weight:bold;color:#0B2559;text-decoration:none;border-radius:12px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function buildResetMessage({ name, resetUrl }) {
  const who = firstName(name);
  const subject = 'Reset your NISMCAA Meeting Room password';
  const text = [
    'Hello ' + who + ',',
    '',
    'We received a request to reset the password for your NISMCAA Meeting Room account.',
    '',
    'Set a new password by opening this link (it expires in 60 minutes and can be used only once):',
    resetUrl,
    '',
    'If you did not ask to reset your password, you can ignore this message. Your password will stay the same.',
    '',
    'NISMCAA Meeting Room',
    'info@nismcaa.com  (470) 684-4463',
    '',
  ].join('\n');
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#0B2559;">Reset your password</h1>
    <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#0B2559;">Hello ${esc(who)},</p>
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#0B2559;">We received a request to reset the password for your NISMCAA Meeting Room account. Use the gold button below to choose a new one. The link expires in 60 minutes and can be used only once.</p>
    ${goldButton(resetUrl, 'Set a new password')}
    <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#5a6478;">If the button does not open, copy and paste this link into your browser:<br><a href="${resetUrl}" style="color:#13347a;word-break:break-all;">${resetUrl}</a></p>
  `;
  return { subject, text, html: emailShell({ title: subject, preheader: 'Set a new password. This link expires in 60 minutes.', bodyHtml, footerNote: 'This message was sent by the NISMCAA Meeting Room. If you did not ask for it, you can ignore it and your password will stay the same.' }) };
}

function buildResetDoneMessage({ name, signInUrl }) {
  const who = firstName(name);
  const subject = 'Your NISMCAA Meeting Room password was changed';
  const text = [
    'Hello ' + who + ',',
    '',
    'The password for your NISMCAA Meeting Room account was just changed.',
    '',
    'You can sign in here:',
    signInUrl,
    '',
    'If you did not make this change, contact NISMCAA at once at info@nismcaa.com or (470) 684-4463.',
    '',
    'NISMCAA Meeting Room',
    '',
  ].join('\n');
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#0B2559;">Your password was changed</h1>
    <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#0B2559;">Hello ${esc(who)},</p>
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#0B2559;">The password for your NISMCAA Meeting Room account was just changed. You can sign in with your new password whenever you are ready.</p>
    ${goldButton(signInUrl, 'Sign in')}
    <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#5a6478;">If you did not make this change, contact NISMCAA at once at <a href="mailto:info@nismcaa.com" style="color:#13347a;">info@nismcaa.com</a> or (470) 684-4463.</p>
  `;
  return { subject, text, html: emailShell({ title: subject, preheader: 'Your password was changed. Sign in when you are ready.', bodyHtml, footerNote: 'This message was sent by the NISMCAA Meeting Room. If you did not make this change, contact us at once.' }) };
}

module.exports = {
  INFO, DEFAULT_HOST, DEFAULT_PORT, configured, configure, send, notifyPassed, queuePassEmail, flush,
  buildPassMessage, buildResetMessage, buildResetDoneMessage, formatWhen, notifyTo, publicBase, isEmail, host, port,
  _setTransport, _reset,
};
