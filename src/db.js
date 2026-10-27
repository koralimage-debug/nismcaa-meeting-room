'use strict';
/**
 * Database: SQLite through better-sqlite3 (one file in DATA_DIR).
 * All tables are created here. To move to Postgres later, this file and the
 * SQL strings in src/routes/* are what must be ported (the app logic stays).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { COUNTRIES, DEPARTMENTS } = require('./config');
const { loadCourse } = require('./content');
const { importPlan } = require('./plan');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  pw_hash TEXT,                       -- scrypt hash, NULL until an admin claims the account
  role TEXT NOT NULL DEFAULT 'volunteer',          -- volunteer | admin
  status TEXT NOT NULL DEFAULT 'applicant',        -- applicant | interest | waiting | approved | declined | ended | admin
  country_chosen TEXT,                -- what the volunteer picked at sign-up
  country TEXT,                       -- final country (set by admin at approval, then locked)
  department TEXT,
  photo_file TEXT,                    -- file name inside DATA_DIR/photos (private)
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  age_confirmed INTEGER NOT NULL DEFAULT 0,
  volunteer_id TEXT UNIQUE,
  id_issued_at TEXT,
  id_expires_at TEXT,
  id_status TEXT,                     -- active | renewal_declined | ended
  decline_reason TEXT,
  approved_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claim_codes (user_id INTEGER PRIMARY KEY, code_hash TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id INTEGER, csrf TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, flash TEXT
);
CREATE TABLE IF NOT EXISTS login_failures (k TEXT PRIMARY KEY, count INTEGER NOT NULL, first_at TEXT NOT NULL, locked_until TEXT);
CREATE TABLE IF NOT EXISTS questions (
  num INTEGER PRIMARY KEY, text TEXT NOT NULL, options TEXT NOT NULL, answer_key TEXT NOT NULL DEFAULT '',
  child_protection INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, answers TEXT NOT NULL,
  score INTEGER, child_correct INTEGER, result TEXT NOT NULL,   -- pass | fail | pending
  passed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS country_links (country TEXT PRIMARY KEY, url TEXT);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL, deleted_at TEXT, deleted_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, id);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, country TEXT, title TEXT NOT NULL, note_date TEXT NOT NULL,
  body TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, country TEXT NOT NULL, department TEXT NOT NULL,
  row_type TEXT NOT NULL DEFAULT 'task',          -- task | phase
  seq INTEGER, title TEXT NOT NULL, owner TEXT DEFAULT '', owner_user_id INTEGER,
  start_date TEXT, deadline TEXT, hard_limit TEXT,
  status TEXT DEFAULT 'Not started', progress INTEGER DEFAULT 0, notes TEXT DEFAULT '', final4 INTEGER DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_cd ON tasks(country, department, sort);
CREATE TABLE IF NOT EXISTS worklog (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS heads (
  country TEXT NOT NULL, department TEXT NOT NULL, user_id INTEGER, assigned_at TEXT, PRIMARY KEY (country, department)
);
CREATE TABLE IF NOT EXISTS remarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, country TEXT NOT NULL, department TEXT NOT NULL, member_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, actor_id INTEGER, target TEXT, detail TEXT, created_at TEXT NOT NULL
);
-- never-reused volunteer numbers (AUTOINCREMENT guarantees a number is not handed out twice)
CREATE TABLE IF NOT EXISTS id_seq (n INTEGER PRIMARY KEY AUTOINCREMENT, issued_at TEXT);
`;

const now = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function openDb(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'photos'), { recursive: true });
  const db = new Database(path.join(config.dataDir, 'meeting_room.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function audit(db, kind, actorId, target, detail) {
  db.prepare('INSERT INTO audit_log(kind,actor_id,target,detail,created_at) VALUES (?,?,?,?,?)')
    .run(kind, actorId || null, target == null ? null : String(target), detail == null ? null : String(detail), now());
}

function getSetting(db, key, dflt = '') {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : dflt;
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

/** Next volunteer ID like NISMCAA-VOL-0001. Numbers are never reused. */
function nextVolunteerId(db) {
  const r = db.prepare('INSERT INTO id_seq(issued_at) VALUES (?)').run(now());
  return 'NISMCAA-VOL-' + String(r.lastInsertRowid).padStart(4, '0');
}

/**
 * First-start seed (production-safe: contains NO answer key, NO passwords, NO test users):
 *  - the 50 questions with an EMPTY answer_key
 *  - empty head seats for every country x department
 *  - the two admin accounts (no password yet) with one-time claim codes
 *  - the Nigeria action plan import (222 tasks)
 * Returns { claimCodes } when admin codes were newly created (so the caller can print them).
 */
async function seed(db, config, hash) {
  const result = { claimCodes: null };
  // questions
  if (db.prepare('SELECT COUNT(*) c FROM questions').get().c === 0) {
    const course = loadCourse(config.courseFile);
    const ins = db.prepare('INSERT INTO questions(num,text,options,answer_key,child_protection) VALUES (?,?,?,?,?)');
    db.transaction(() => course.questions.forEach((q) => ins.run(q.num, q.text, JSON.stringify(q.options), '', q.childProtection ? 1 : 0)))();
  }
  // head seats (always empty at start)
  const seat = db.prepare('INSERT OR IGNORE INTO heads(country,department,user_id) VALUES (?,?,NULL)');
  db.transaction(() => COUNTRIES.forEach((c) => DEPARTMENTS.forEach((d) => seat.run(c, d))))();
  // admins
  const codes = {};
  for (const email of config.adminEmails) {
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) continue;
    const name = config.adminNames[email] || email;
    const r = db.prepare(`INSERT INTO users(email,name,role,status,created_at) VALUES (?,?, 'admin','admin',?)`).run(email, name, now());
    const code = crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})(.{5})/, '$1-$2');
    db.prepare('INSERT INTO claim_codes(user_id,code_hash) VALUES (?,?)').run(r.lastInsertRowid, sha256(code));
    codes[email] = code;
  }
  if (Object.keys(codes).length) {
    result.claimCodes = codes;
    const file = path.join(config.dataDir, 'ADMIN_CLAIM_CODES.txt');
    const body = [
      'NISMCAA Meeting Room: one-time admin claim codes',
      'Open /admin/claim on the site, enter your own e-mail, the code below, and choose your own password.',
      'Each code works once. Delete this file after both admins have claimed their accounts.',
      '',
      ...Object.entries(codes).map(([e, c]) => `${e}: ${c}`),
      '',
    ].join('\n');
    fs.writeFileSync(file, body, { mode: 0o600 });
  }
  // Nigeria plan
  if (db.prepare("SELECT COUNT(*) c FROM tasks WHERE country='Nigeria'").get().c === 0 && fs.existsSync(config.planFile)) {
    await importPlan(db, config.planFile, 'Nigeria');
  }
  // default settings
  if (getSetting(db, 'call_link_main', null) === null) setSetting(db, 'call_link_main', '');
  return result;
}

module.exports = { openDb, seed, audit, getSetting, setSetting, nextVolunteerId, now, sha256 };
