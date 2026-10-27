'use strict';
/**
 * Central configuration. Everything comes from environment variables so the
 * same code runs on a laptop, in tests, and later on Render.
 *
 *   PORT            web port (default 3000)
 *   DATA_DIR        folder for the SQLite file, photos and the admin claim-code file.
 *                   On Render, point this at a persistent disk (e.g. /var/data).
 *   PUBLIC_URL      public address of the site, used inside QR codes
 *                   (e.g. https://meeting.nismcaa.com). Empty = use the request's host.
 *   NODE_ENV        "production" turns on secure cookies and proxy trust.
 *   ADMIN_EMAILS    comma list of admin e-mails (default: John and Abisade).
 *   TODAY_OVERRIDE  YYYY-MM-DD, TESTING ONLY: pretend today is this date (flags).
 */
const path = require('path');

const COUNTRIES = [
  'United States', 'Nigeria', 'Canada', 'United Arab Emirates', 'United Kingdom', 'Australia',
];
const NOT_LISTED = "My country isn't listed";

const DEPARTMENTS = [
  'Office of the Founder', 'Programs & Competition', 'Child Welfare & Safeguarding',
  'Event Operations', 'Media & Communications', 'Partnerships & Sponsorship',
  'Academy & Education', 'Finance & Admin', 'Technology', 'International & Diplomacy',
];

const PLAN_STATUSES = ['Not started', 'In progress', 'Blocked', 'On hold', 'Done'];

// The one business phone number (never use any other).
const BUSINESS_PHONE = '(470) 739-0021';

function slug(s) {
  return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function loadConfig(env = process.env) {
  const root = path.join(__dirname, '..');
  return {
    root,
    port: Number(env.PORT || 3000),
    dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data_local')),
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    production: env.NODE_ENV === 'production',
    adminEmails: (env.ADMIN_EMAILS || 'interschoolmusic@gmail.com,abisade@nismcaa.com')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    adminNames: { 'interschoolmusic@gmail.com': 'John Adebowale', 'abisade@nismcaa.com': 'Abisade Adebowale' },
    todayOverride: env.TODAY_OVERRIDE || '',
    displayTz: env.DISPLAY_TZ || 'America/New_York',
    courseFile: path.join(root, 'content', 'COURSE_TEXT.txt'),
    planFile: path.join(root, 'data', 'ACTION_PLAN_10th_Edition.xlsx'),
    // Tuning knobs (tests lower these)
    scryptN: Number(env.SCRYPT_N || 16384),
    sessionIdleMs: 3 * 24 * 3600 * 1000,
    lockMinutes: 15,
    lockAfter: 5,
    quiet: env.QUIET === '1',
    // Per-IP rate limits (tests raise them)
    limits: { signupPerHour: 10, loginPer15Min: 40, claimPer15Min: 10, verifyPerMin: 60 },
  };
}

module.exports = { loadConfig, COUNTRIES, NOT_LISTED, DEPARTMENTS, PLAN_STATUSES, BUSINESS_PHONE, slug };
