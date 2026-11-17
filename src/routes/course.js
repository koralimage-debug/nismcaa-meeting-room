'use strict';
/** Volunteer course (public to read) and the 50-question final test. */
const crypto = require('crypto');
const { now, audit, getSetting } = require('../db');
const { DEFAULT_TEST_TIME_LIMIT_MINUTES } = require('../config');

const PASS_PERCENT = 80;      // 40 of 50
const CHILD_MIN = 9;          // of the 10 child-protection questions (Q41-50)

/** Is every one of the 50 answers entered in the key? */
function keyComplete(db) {
  const rows = db.prepare('SELECT num, options, answer_key FROM questions').all();
  return rows.length === 50 && rows.every((r) => JSON.parse(r.options).some((o) => o.letter === r.answer_key));
}

/**
 * Grade a set of answers {num: 'A'..}.
 * Returns { result: 'pending' } until the key is complete, otherwise pass/fail.
 * Pass = at least 80% of all 50 AND at least 9 of the 10 child-protection questions.
 */
function grade(db, answers) {
  if (!keyComplete(db)) return { result: 'pending', score: null, child: null, passed: 0 };
  const rows = db.prepare('SELECT num, answer_key, child_protection FROM questions').all();
  let score = 0; let child = 0;
  for (const q of rows) {
    if (answers[q.num] === q.answer_key) { score += 1; if (q.child_protection) child += 1; }
  }
  const passed = score * 100 >= PASS_PERCENT * rows.length && child >= CHILD_MIN;
  return { result: passed ? 'pass' : 'fail', score, child, passed: passed ? 1 : 0 };
}

/** Save the outcome of one attempt and move the volunteer to "Waiting for approval" if passed. */
function recordAttempt(db, userId, answers, g, attemptId) {
  if (attemptId) {
    db.prepare('UPDATE attempts SET answers=?, score=?, child_correct=?, result=?, passed=? WHERE id=?')
      .run(JSON.stringify(answers), g.score, g.child, g.result, g.passed, attemptId);
  } else {
    db.prepare('INSERT INTO attempts(user_id,answers,score,child_correct,result,passed,created_at,started_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(userId, JSON.stringify(answers), g.score, g.child, g.result, g.passed, now(), now());
  }
  if (g.passed) {
    const u = db.prepare('SELECT status FROM users WHERE id=?').get(userId);
    if (u && u.status === 'applicant') {
      db.prepare("UPDATE users SET status='waiting' WHERE id=?").run(userId);
      audit(db, 'test_passed', userId, userId, `score ${g.score}/50, child protection ${g.child}/10`);
    }
  }
}

/** Re-grade attempts saved while the key was missing (admin button). Returns how many were graded. */
function regradePending(db) {
  if (!keyComplete(db)) return -1;
  const pend = db.prepare("SELECT * FROM attempts WHERE result='pending' ORDER BY id").all();
  const upd = db.prepare('UPDATE attempts SET score=?, child_correct=?, result=?, passed=? WHERE id=?');
  db.transaction(() => {
    for (const a of pend) {
      const g = grade(db, JSON.parse(a.answers));
      upd.run(g.score, g.child, g.result, g.passed, a.id);
      if (g.passed) {
        const u = db.prepare('SELECT status FROM users WHERE id=?').get(a.user_id);
        if (u && u.status === 'applicant') {
          db.prepare("UPDATE users SET status='waiting' WHERE id=?").run(a.user_id);
          audit(db, 'test_passed', a.user_id, a.user_id, `regraded: score ${g.score}/50, child protection ${g.child}/10`);
        }
      }
    }
  })();
  return pend.length;
}

/** Minutes allowed for one test attempt. Admin setting wins; otherwise the config constant (default 20). */
function testLimitMin(db, config) {
  const raw = getSetting(db, 'test_time_limit_minutes', '');
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const fromConfig = config && Number(config.testTimeLimitMin);
  return Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : DEFAULT_TEST_TIME_LIMIT_MINUTES;
}

function testLimitMs(db, config) {
  return Math.round(testLimitMin(db, config) * 60 * 1000);
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/** New random question order (child-protection stays in the second half) and option order. */
function buildOrder(db) {
  const rows = db.prepare('SELECT num, options FROM questions ORDER BY num').all();
  const general = shuffle(rows.filter((q) => q.num <= 40).map((q) => q.num));
  const child = shuffle(rows.filter((q) => q.num > 40).map((q) => q.num));
  const options = {};
  for (const q of rows) {
    options[String(q.num)] = shuffle(JSON.parse(q.options).map((o) => o.letter));
  }
  return { questions: general.concat(child), options };
}

function parseOrder(raw) {
  try {
    const o = JSON.parse(raw || '');
    if (o && Array.isArray(o.questions) && o.questions.length === 50 && o.options && typeof o.options === 'object') return o;
  } catch (e) { /* ignore */ }
  return null;
}

function applyOrder(questions, order) {
  const byNum = Object.fromEntries(questions.map((q) => [q.num, q]));
  const nums = (order && order.questions) || questions.map((q) => q.num);
  return nums.map((num) => {
    const q = byNum[num];
    if (!q) return null;
    const letters = (order && order.options && (order.options[String(num)] || order.options[num])) || q.options.map((o) => o.letter);
    const opts = letters.map((letter) => q.options.find((o) => o.letter === letter)).filter(Boolean);
    return { ...q, options: opts.length ? opts : q.options };
  }).filter(Boolean);
}

function loadQuestions(db) {
  return db.prepare('SELECT num, text, options, child_protection FROM questions ORDER BY num').all()
    .map((q) => ({ num: q.num, text: q.text, options: JSON.parse(q.options), childProtection: !!q.child_protection }));
}

function openAttempt(db, userId) {
  return db.prepare("SELECT * FROM attempts WHERE user_id=? AND result='in_progress' ORDER BY id DESC LIMIT 1").get(userId);
}

function lastFinished(db, userId) {
  return db.prepare("SELECT * FROM attempts WHERE user_id=? AND result<>'in_progress' ORDER BY id DESC LIMIT 1").get(userId);
}

function attemptExpired(attempt, limitMs) {
  if (!attempt) return false;
  const start = Date.parse(attempt.started_at || attempt.created_at);
  if (!Number.isFinite(start)) return true;
  return Date.now() >= start + limitMs;
}

function expireAttempt(db, attempt, answers) {
  if (!attempt || attempt.result !== 'in_progress') return;
  const body = answers == null ? attempt.answers : JSON.stringify(answers);
  db.prepare("UPDATE attempts SET answers=?, result='timed_out', score=NULL, child_correct=NULL, passed=0 WHERE id=? AND result='in_progress'")
    .run(body, attempt.id);
}

function formatTimeLeft(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function endsAtIso(attempt, limitMs) {
  return new Date(Date.parse(attempt.started_at || attempt.created_at) + limitMs).toISOString();
}

module.exports = function (app, ctx) {
  const { db, course, config } = ctx;

  // Guests (sponsors and vendors) do not take the course or the test, and do not see child-protection material.
  app.use('/course', (req, res, next) => (req.user && req.user.role === 'guest'
    ? res.status(403).render('error', { title: 'Volunteers only', message: 'The course and final test are for volunteers. Your page is the Guest Meeting Room.' }) : next()));

  app.get('/course', (req, res) => res.render('course', { title: 'Volunteer course', course }));

  const testState = (u) => {
    if (u.status === 'applicant') return 'open';
    return u.status; // waiting | approved | interest | declined | ended
  };

  const renderTest = (req, res, extra = {}) => {
    const limitMs = testLimitMs(db, config);
    res.render('test', {
      title: 'Final test',
      questions: [],
      last: lastFinished(db, req.user.id),
      errors: [],
      keyReady: keyComplete(db),
      started: false,
      timedOut: false,
      endsAt: '',
      timeLeftLabel: '',
      timeUrgent: false,
      limitMin: testLimitMin(db, config),
      ...extra,
    });
  };

  app.get('/course/test', (req, res) => {
    if (!req.user) return res.redirect('/sign-in?next=/course/test');
    if (req.user.role === 'admin') return res.render('test-closed', { title: 'Final test', state: 'admin' });
    const state = testState(req.user);
    if (state !== 'open') return res.render('test-closed', { title: 'Final test', state });
    const limitMs = testLimitMs(db, config);
    const open = openAttempt(db, req.user.id);
    if (open && attemptExpired(open, limitMs)) {
      expireAttempt(db, open);
      return renderTest(req, res, { timedOut: true });
    }
    if (open) {
      const left = Date.parse(open.started_at || open.created_at) + limitMs - Date.now();
      const questions = applyOrder(loadQuestions(db), parseOrder(open.order_json));
      return renderTest(req, res, {
        started: true,
        questions,
        endsAt: endsAtIso(open, limitMs),
        timeLeftLabel: formatTimeLeft(left),
        timeUrgent: left <= 2 * 60 * 1000,
      });
    }
    const last = lastFinished(db, req.user.id);
    return renderTest(req, res, { timedOut: !!(last && last.result === 'timed_out') });
  });

  app.post('/course/test/start', (req, res) => {
    if (!req.user) return res.redirect('/sign-in?next=/course/test');
    if (req.user.role === 'admin' || req.user.status !== 'applicant') return res.redirect('/course/test');
    const limitMs = testLimitMs(db, config);
    const open = openAttempt(db, req.user.id);
    if (open && !attemptExpired(open, limitMs)) return res.redirect('/course/test');
    if (open && attemptExpired(open, limitMs)) expireAttempt(db, open);
    const started = now();
    const order = buildOrder(db);
    db.prepare('INSERT INTO attempts(user_id,answers,score,child_correct,result,passed,created_at,started_at,order_json) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(req.user.id, '{}', null, null, 'in_progress', 0, started, started, JSON.stringify(order));
    res.redirect('/course/test');
  });

  app.post('/course/test', (req, res) => {
    if (!req.user) return res.redirect('/sign-in?next=/course/test');
    if (req.user.role === 'admin' || req.user.status !== 'applicant') return res.redirect('/course/test');
    const limitMs = testLimitMs(db, config);
    const open = openAttempt(db, req.user.id);
    if (!open) {
      req.flash('err', 'Please start the test first. The timer begins when you start.');
      return res.redirect('/course/test');
    }
    const qs = db.prepare('SELECT num, options FROM questions ORDER BY num').all();
    const answers = {}; const missing = [];
    for (const q of qs) {
      const a = String(req.body['q' + q.num] || '');
      if (JSON.parse(q.options).some((o) => o.letter === a)) answers[q.num] = a; else missing.push(q.num);
    }
    if (attemptExpired(open, limitMs)) {
      expireAttempt(db, open, Object.keys(answers).length ? answers : null);
      return res.redirect('/course/test');
    }
    if (missing.length) {
      req.flash('err', `Please answer every question. Not answered yet: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}.`);
      return res.redirect('/course/test');
    }
    const g = grade(db, answers);
    recordAttempt(db, req.user.id, answers, g, open.id);
    res.redirect('/course/test/result');
  });

  app.get('/course/test/result', (req, res) => {
    if (!req.user) return res.redirect('/sign-in');
    const last = lastFinished(db, req.user.id);
    if (!last) return res.redirect('/course/test');
    res.render('test-result', { title: 'Your test result', last, limitMin: testLimitMin(db, config) });
  });
};

module.exports.grade = grade;
module.exports.recordAttempt = recordAttempt;
module.exports.regradePending = regradePending;
module.exports.keyComplete = keyComplete;
module.exports.PASS_PERCENT = PASS_PERCENT;
module.exports.CHILD_MIN = CHILD_MIN;
module.exports.testLimitMin = testLimitMin;
module.exports.testLimitMs = testLimitMs;
module.exports.buildOrder = buildOrder;
module.exports.applyOrder = applyOrder;
