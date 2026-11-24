'use strict';
/**
 * Central configuration. Everything comes from environment variables so the
 * same code runs on a laptop, in tests, and later on Render.
 *
 *   PORT            web port (default 3000)
 *   DATA_DIR        folder for the SQLite file, photos and the admin claim-code file
 *                   (read from the environment; local default is ./data_local).
 *                   On Render, point this at a folder on the persistent disk (e.g. /var/data/nismcaa-data).
 *   PUBLIC_URL      public address of the site, used inside QR codes
 *                   (e.g. https://meeting.nismcaa.com). Empty = use the request's host.
 *   NODE_ENV        "production" turns on secure cookies and proxy trust.
 *   ADMIN_EMAILS    comma list of admin e-mails (default: Olushola John Adebowale and Abisade Adebowale).
 *                   abisade@nismcaa.com is always included, even if omitted from the list.
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

// Guests (sponsors and vendors): separate from volunteers.
const GUEST_KINDS = { sponsor: 'Sponsor', vendor: 'Vendor' };
const AUDIENCES = { volunteers: 'Volunteers', sponsors: 'All sponsors', vendors: 'All vendors', invited: 'Specific guests' };
// Time zones offered when scheduling a meeting (US first; Eastern is the default).
const MEETING_ZONES = [
  ['America/New_York', 'Eastern Time (US)'], ['America/Chicago', 'Central Time (US)'], ['America/Denver', 'Mountain Time (US)'],
  ['America/Los_Angeles', 'Pacific Time (US)'], ['America/Anchorage', 'Alaska Time (US)'], ['Pacific/Honolulu', 'Hawaii Time (US)'],
  ['UTC', 'UTC'], ['Africa/Lagos', 'West Africa Time (Lagos)'], ['Europe/London', 'London'], ['Asia/Dubai', 'Dubai'], ['Australia/Sydney', 'Sydney'],
];

const PLAN_STATUSES = ['Not started', 'In progress', 'Blocked', 'On hold', 'Done'];

// The one business phone number (never use any other).
const BUSINESS_PHONE = '(470) 684-4463';

// Default time allowed for one volunteer final-test attempt, in minutes.
// Admins can change this in Settings (stored as test_time_limit_minutes).
// Tests may override with the TEST_TIME_LIMIT_MINUTES environment variable.
const DEFAULT_TEST_TIME_LIMIT_MINUTES = 20;

function slug(s) {
  return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}


const DEFAULT_ADMIN_EMAILS = 'interschoolmusic@gmail.com,abisade@nismcaa.com';
const ALWAYS_ADMIN_EMAILS = ['abisade@nismcaa.com'];

function adminEmailList(env) {
  const list = (env.ADMIN_EMAILS || DEFAULT_ADMIN_EMAILS)
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const email of ALWAYS_ADMIN_EMAILS) {
    if (!list.includes(email)) list.push(email);
  }
  return list;
}

function loadConfig(env = process.env) {
  const root = path.join(__dirname, '..');
  return {
    root,
    port: Number(env.PORT || 3000),
    dataDir: path.resolve(String(env.DATA_DIR || '').trim() || path.join(root, 'data_local')),
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    production: env.NODE_ENV === 'production',
    adminEmails: adminEmailList(env),
    adminNames: { 'interschoolmusic@gmail.com': 'Olushola John Adebowale', 'abisade@nismcaa.com': 'Abisade Adebowale', 'adebowaleabisolami@gmail.com': 'Abisolami Adebowale' },
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
    limits: { signupPerHour: 10, loginPer15Min: 40, claimPer15Min: 10, verifyPerMin: 60, forgotPer15Min: 10, forgotEmailPerHour: 3, resetPer15Min: 20 },
    testTimeLimitMin: (function () {
      const n = Number(env.TEST_TIME_LIMIT_MINUTES || DEFAULT_TEST_TIME_LIMIT_MINUTES);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_TEST_TIME_LIMIT_MINUTES;
    })(),
  };
}

module.exports = {
  GUEST_KINDS, AUDIENCES, MEETING_ZONES,
  loadConfig, COUNTRIES, NOT_LISTED, DEPARTMENTS, PLAN_STATUSES, BUSINESS_PHONE, slug,
  DEFAULT_TEST_TIME_LIMIT_MINUTES };
