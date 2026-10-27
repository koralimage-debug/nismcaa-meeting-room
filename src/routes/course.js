'use strict';
/** Volunteer course (public to read) and the 50-question final test. */
const { now, audit } = require('../db');

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
function recordAttempt(db, userId, answers, g) {
  db.prepare('INSERT INTO attempts(user_id,answers,score,child_correct,result,passed,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(userId, JSON.stringify(answers), g.score, g.child, g.result, g.passed, now());
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

module.exports = function (app, ctx) {
  const { db, course } = ctx;

  app.get('/course', (req, res) => res.render('course', { title: 'Volunteer course', course }));

  const testState = (u) => {
    if (u.status === 'applicant') return 'open';
    return u.status; // waiting | approved | interest | declined | ended
  };

  app.get('/course/test', (req, res) => {
    if (!req.user) return res.redirect('/sign-in?next=/course/test');
    if (req.user.role === 'admin') return res.render('test-closed', { title: 'Final test', state: 'admin' });
    const state = testState(req.user);
    if (state !== 'open') return res.render('test-closed', { title: 'Final test', state });
    const questions = db.prepare('SELECT num, text, options, child_protection FROM questions ORDER BY num').all()
      .map((q) => ({ num: q.num, text: q.text, options: JSON.parse(q.options), childProtection: !!q.child_protection }));
    const last = db.prepare('SELECT * FROM attempts WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
    res.render('test', { title: 'Final test', questions, last, errors: [], keyReady: keyComplete(db) });
  });

  app.post('/course/test', (req, res) => {
    if (!req.user) return res.redirect('/sign-in?next=/course/test');
    if (req.user.role === 'admin' || req.user.status !== 'applicant') return res.redirect('/course/test');
    const qs = db.prepare('SELECT num, options FROM questions ORDER BY num').all();
    const answers = {}; const missing = [];
    for (const q of qs) {
      const a = String(req.body['q' + q.num] || '');
      if (JSON.parse(q.options).some((o) => o.letter === a)) answers[q.num] = a; else missing.push(q.num);
    }
    if (missing.length) {
      req.flash('err', `Please answer every question. Not answered yet: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}.`);
      return res.redirect('/course/test');
    }
    const g = grade(db, answers);
    recordAttempt(db, req.user.id, answers, g);
    res.redirect('/course/test/result');
  });

  app.get('/course/test/result', (req, res) => {
    if (!req.user) return res.redirect('/sign-in');
    const last = db.prepare('SELECT * FROM attempts WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
    if (!last) return res.redirect('/course/test');
    res.render('test-result', { title: 'Your test result', last });
  });
};

module.exports.grade = grade;
module.exports.recordAttempt = recordAttempt;
module.exports.regradePending = regradePending;
module.exports.keyComplete = keyComplete;
module.exports.PASS_PERCENT = PASS_PERCENT;
module.exports.CHILD_MIN = CHILD_MIN;
