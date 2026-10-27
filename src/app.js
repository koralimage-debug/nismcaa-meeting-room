'use strict';
/**
 * Builds the Express app. createApp(config) returns { app, db, ... } so tests can
 * start many isolated copies (each with its own DATA_DIR).
 */
const path = require('path');
const express = require('express');
const { openDb, seed, getSetting } = require('./db');
const sec = require('./security');
const access = require('./access');
const cfg = require('./config');
const { loadCourse } = require('./content');

function todayStr(config) {
  if (config.todayOverride) return config.todayOverride;
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.displayTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function createApp(config) {
  const db = openDb(config);
  const seedResult = await seed(db, config);
  const course = loadCourse(config.courseFile);
  const app = express();
  const sessions = sec.makeSessions(db, config);
  const lockout = sec.makeLockout(db, config);
  const ctx = {
    config, db, sessions, lockout, course, sec, access, cfg, todayStr: () => todayStr(config),
    limiters: {
      signup: sec.makeLimiter(config.limits.signupPerHour, 3600000),
      login: sec.makeLimiter(config.limits.loginPer15Min, 15 * 60000),
      claim: sec.makeLimiter(config.limits.claimPer15Min, 15 * 60000),
      verify: sec.makeLimiter(config.limits.verifyPerMin, 60000),
    },
  };

  app.disable('x-powered-by');
  app.set('trust proxy', config.production ? 1 : false);
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.root, 'views'));

  // Security headers. No inline scripts are used, so a strict policy is possible.
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (config.production) res.set('Strict-Transport-Security', 'max-age=15552000');
    next();
  });
  app.get('/healthz', (req, res) => res.type('text/plain').send('ok')); // for the host's health check (no session, no database)
  app.use('/static', express.static(path.join(config.root, 'public'), { maxAge: config.production ? '1h' : 0 }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/img/logo.png'));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '50kb' }));
  app.use(sessions.load);

  // Template helpers available in every view
  app.use((req, res, next) => {
    const tz = config.displayTz;
    const L = res.locals;
    L.user = req.user; L.path = req.path;
    L.COUNTRIES = cfg.COUNTRIES; L.NOT_LISTED = cfg.NOT_LISTED; L.DEPARTMENTS = cfg.DEPARTMENTS; L.slug = cfg.slug;
    L.PHONE = cfg.BUSINESS_PHONE; L.access = access; L.isAdmin = access.isAdmin(req.user);
    L.fmtDate = (s) => (s ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(String(s).length === 10 ? s + 'T00:00:00Z' : s)) : '');
    L.fmtDateTime = (s) => (s ? new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(s)) : '');
    L.pendingCount = 0;
    if (L.isAdmin) L.pendingCount = db.prepare("SELECT COUNT(*) c FROM users WHERE status='waiting'").get().c;
    L.title = ''; L.mainTab = '';
    next();
  });

  app.use(sec.csrfCheck); // after the template helpers so its error page renders fully

  // Forced password change (temporary passwords)
  app.use((req, res, next) => {
    if (req.user && req.user.must_change_pw && !['/account/password', '/sign-out'].includes(req.path)) return res.redirect('/account/password');
    next();
  });

  for (const r of ['auth', 'course', 'room', 'plan', 'admin']) require('./routes/' + r)(app, ctx);

  app.use((req, res) => res.status(404).render('error', { title: 'Page not found', message: 'We could not find that page.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (!config.quiet) console.error(err);
    res.status(err.status || 500).render('error', { title: 'Something went wrong', message: 'Sorry, something went wrong on our side. Please try again.' });
  });

  return { app, db, ctx, claimCodes: seedResult.claimCodes, close: () => db.close() };
}

module.exports = { createApp, todayStr };
