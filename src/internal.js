'use strict';
/**
 * Internal volunteer lookup for nismcaa.com event check-in (server to server only).
 *
 *   GET /internal/volunteers/:vid   -> is this Meeting Room ID approved and current?
 *
 * Auth: header "X-Internal-Key" must equal env VOLUNTEER_LOOKUP_KEY (32+ characters).
 * If the env var is missing or too short the API is OFF (503). The key is never logged or echoed.
 * No session, no cookie, no CSRF (GET only). Responses carry only what check-in needs: no e-mail, phone or photo.
 */
const crypto = require('crypto');
const access = require('./access');

const VID_RE = /^NISMCAA-VOL-\d{4,}$/;
const MIN_KEY = 32;

function keyOk(want, sent) {
  // Compare fixed-length digests so the check takes the same time whatever was sent.
  const a = crypto.createHash('sha256').update(String(sent || '')).digest();
  const b = crypto.createHash('sha256').update(String(want)).digest();
  return crypto.timingSafeEqual(a, b) && String(sent || '').length === String(want).length;
}

function publicRecord(u) {
  const state = access.idState(u); // VALID | EXPIRED | ENDED | null
  const approved = u.status === 'approved';
  const expiry = Date.parse(u.id_expires_at || '');
  return {
    volunteer_id: u.volunteer_id,
    name: u.name,
    country: u.country || '',
    department: u.department || '',
    status: u.status,
    id_state: state,
    id_expires_at: u.id_expires_at || '',
    approved,
    current: approved && u.id_status === 'active' && state === 'VALID' && Number.isFinite(expiry) && expiry > Date.now(), // true = may start an event shift
  };
}

module.exports = function mountInternal(app, ctx) {
  const { db, config } = ctx;
  const limiter = ctx.sec.makeLimiter(config.limits.internalPerMin || 120, 60000);

  app.use('/internal', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
    const want = config.volunteerLookupKey || '';
    if (want.length < MIN_KEY) return res.status(503).json({ error: 'lookup disabled' });
    if (limiter.hit('internal:' + (req.ip || ''))) return res.status(429).json({ error: 'too many requests' });
    if (!keyOk(want, req.get('x-internal-key'))) return res.status(401).json({ error: 'unauthorized' });
    next();
  });

  app.get('/internal/volunteers/:vid', (req, res) => {
    const vid = String(req.params.vid || '').trim().toUpperCase();
    if (!VID_RE.test(vid)) return res.status(400).json({ found: false, error: 'bad id format' });
    const u = db.prepare("SELECT name, country, department, status, volunteer_id, id_expires_at, id_status FROM users WHERE role='volunteer' AND volunteer_id=?").get(vid);
    if (!u) return res.status(404).json({ found: false, volunteer_id: vid });
    res.json({ found: true, ...publicRecord(u) });
  });

};
module.exports.VID_RE = VID_RE;
