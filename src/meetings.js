'use strict';
/**
 * Scheduled meetings with an audience, and time-zone helpers.
 * Audiences: volunteers (optionally one country team), all sponsors, all vendors, or specific guests.
 * Visibility is decided here, on the server, for every page that lists meetings.
 */
const { MEETING_ZONES } = require('./config');

const ZONE_IDS = MEETING_ZONES.map((z) => z[0]);

/** Offset (ms) of a zone from UTC at a given instant. */
function tzOffsetMs(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
/** 'YYYY-MM-DD' + 'HH:MM' written in zone tz -> UTC ISO string (or null when invalid). */
function localToUtcIso(date, time, tz) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '') || !ZONE_IDS.includes(tz)) return null;
  const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const t = guess - tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
  const check = new Date(t);
  return Number.isNaN(check.getTime()) ? null : check.toISOString();
}
/** UTC ISO -> { date: 'YYYY-MM-DD', time: 'HH:MM' } as written in zone tz (for the edit form). */
function utcIsoToLocal(iso, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
/** "Thu, Nov 12, 2026, 2:00 PM EST" in the meeting's own zone. */
function fmtWhen(iso, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}
function fmtUtc(iso) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}
const endMs = (m) => Date.parse(m.starts_at) + m.duration_min * 60000;
const zoneLabel = (tz) => (MEETING_ZONES.find((z) => z[0] === tz) || [tz, tz])[1];

function decorate(db, m) {
  return { ...m, when: fmtWhen(m.starts_at, m.tz), utc: fmtUtc(m.starts_at), zoneName: zoneLabel(m.tz) };
}

/** Meetings an ordinary (non-admin) user may see. Returns [] for anyone who may not. */
function meetingsFor(db, user, access, nowMs = Date.now()) {
  let rows = [];
  if (access.hasGuestAccess(user)) {
    const kindAud = db.prepare('SELECT kind FROM guests WHERE user_id=?').get(user.id);
    const aud = kindAud ? (kindAud.kind === 'sponsor' ? 'sponsors' : 'vendors') : null;
    rows = db.prepare(`SELECT * FROM meetings m WHERE (m.audience=? OR (m.audience='invited' AND EXISTS (SELECT 1 FROM meeting_invites i WHERE i.meeting_id=m.id AND i.user_id=?)))
      ORDER BY starts_at`).all(aud || '-', user.id);
  } else if (!access.isGuest(user) && access.hasRoomAccess(user) && !access.isAdmin(user)) {
    rows = db.prepare("SELECT * FROM meetings WHERE audience='volunteers' AND (country IS NULL OR country=?) ORDER BY starts_at").all(user.country);
  } else return { upcoming: [], past: [] };
  const all = rows.map((m) => decorate(db, m));
  return { upcoming: all.filter((m) => endMs(m) >= nowMs), past: all.filter((m) => endMs(m) < nowMs).reverse().slice(0, 5) };
}

module.exports = { localToUtcIso, utcIsoToLocal, fmtWhen, decorate, meetingsFor, endMs, zoneLabel, ZONE_IDS };
