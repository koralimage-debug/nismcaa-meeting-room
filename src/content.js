'use strict';
/**
 * Reads content/COURSE_TEXT.txt (copied from John's files) and turns it into
 * structured data: course sections and the 50 final-test questions.
 *
 * The lesson wording is NOT changed. Only layout is rebuilt (the source file
 * was extracted from a PDF, so lines are hard-wrapped and tables are broken
 * into one cell per paragraph).
 *
 * Left out on purpose (they are notes to the builder or do not fit this site):
 *  - the bracketed "MEETING ROOM SITE NOTE" and the "Removed from the public page" line
 *  - the PDF cover page and the two "Practice questions" intro notes (they say that
 *    results are not saved, which is not true for the final test here)
 */
const fs = require('fs');

// Tables in the PDF text, in order of appearance: [first cell, columns, total rows incl. header]
const TABLES = [
  ['Edition', 2, 10],
  ['Assessment area', 2, 5],
  ['Position', 3, 4],
  ['Scoring area', 2, 7],
  ['Scoring area', 2, 6],
];
const TABLE_STARTS = new Set(TABLES.map((t) => t[0]));
const TERMINAL = /[.!?:)”"]$/;

function splitBlocks(lines) {
  // make sure a table's first cell is its own block
  const prepared = [];
  lines.forEach((l, i) => {
    if (TABLE_STARTS.has(l.trim()) && prepared.length && prepared[prepared.length - 1].trim() !== '') prepared.push('');
    prepared.push(l);
  });
  const blocks = [];
  let cur = [];
  for (const l of prepared) {
    if (l.trim() === '') { if (cur.length) blocks.push(cur); cur = []; } else cur.push(l.trim());
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

const isBullet = (l) => /^([-•])\s+/.test(l);
const stripBullet = (l) => l.replace(/^([-•])\s+/, '');
const looksLikeHeading = (l) => l.length <= 62 && !TERMINAL.test(l) && !isBullet(l);

/** Turn one section of text lines into display elements. */
function parseElements(lines) {
  const blocks = splitBlocks(lines);
  const out = [];
  let tableIdx = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const spec = TABLES[tableIdx];
    if (spec && b.length === 1 && b[0] === spec[0]) {
      const [, cols, rows] = spec;
      const cells = blocks.slice(i, i + cols * rows).map((c) => c.join(' '));
      const trs = [];
      for (let r = 0; r < rows; r++) trs.push(cells.slice(r * cols, (r + 1) * cols));
      out.push({ type: 'table', header: trs[0], rows: trs.slice(1) });
      i += cols * rows - 1;
      tableIdx++;
      continue;
    }
    let ls = b.slice();
    // leading headings: a lesson title and/or a short sub-heading line
    let guard = 0;
    while (ls.length && guard++ < 2) {
      if (/^Lesson \d+:/.test(ls[0])) { out.push({ type: 'lesson', text: ls.shift() }); continue; }
      if (looksLikeHeading(ls[0])) { out.push({ type: 'h', text: ls.shift() }); continue; }
      break;
    }
    // paragraphs and bullet lists
    let para = []; let list = null; let li = null;
    const flushPara = () => { if (para.length) { out.push({ type: 'p', text: para.join(' ') }); para = []; } };
    const flushList = () => { if (list) { out.push({ type: 'ul', items: list }); list = null; li = null; } };
    for (let k = 0; k < ls.length; k++) {
      const l = ls[k];
      const moreBullets = ls.slice(k + 1).some(isBullet);
      if (isBullet(l)) {
        flushPara();
        if (!list) list = [];
        li = stripBullet(l); list.push(li);
        continue;
      }
      if (list) {
        const last = list[list.length - 1];
        if (!TERMINAL.test(last) || moreBullets) { list[list.length - 1] = last + ' ' + l; continue; }
        flushList();
      }
      // The PDF text is hard-wrapped. A short line that ends a sentence, or a line starting "Remember:", begins a new paragraph.
      if (para.length && (/^Remember:/.test(l) || (/[.!?]$/.test(para[para.length - 1]) && para[para.length - 1].length < 80))) flushPara();
      para.push(l);
    }
    flushPara(); flushList();
  }
  return out;
}

function words(s) {
  return s.replace(/[•]/g, ' ').split(/\s+/).filter((w) => w && w !== '-');
}

function loadCourse(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const p1 = raw.indexOf('===== PART 1: PAGE TEXT =====');
  const p2 = raw.indexOf('===== PART 2: COURSE PDF TEXT =====');
  if (p1 < 0 || p2 < 0) throw new Error('COURSE_TEXT.txt markers not found');

  // ---- PART 1 ----
  const part1Lines = raw.slice(p1, p2).split('\n').slice(1)
    .filter((l) => !l.startsWith('[Removed from'))
    .map((l) => l.replace(/\s*\[MEETING ROOM SITE NOTE:[^\]]*\]/, ''));
  const part1 = [];
  for (const b of splitBlocks(part1Lines)) {
    if (b.length === 1) part1.push({ type: 'p', text: b[0] });
    else part1.push({ type: 'h', text: b[0] }, { type: 'p', text: b.slice(1).join(' ') });
  }

  // ---- PART 2 ----
  const lines2 = raw.slice(p2).split('\n').slice(1);
  const idx = (text, from = 0) => { for (let i = from; i < lines2.length; i++) if (lines2[i].trim() === text) return i; return -1; };
  const orientStart = idx('NISMCAA Orientation Course');
  const practice1 = idx('Practice questions', orientStart);
  const ccpStart = idx('Child Care & Protection', practice1);
  const practice2 = idx('Practice questions', ccpStart);
  const qStart = idx('1. What does NISMCAA combine?', practice2);
  if ([orientStart, practice1, ccpStart, practice2, qStart].some((x) => x < 0)) throw new Error('course sections not found');

  const orient = parseElements(lines2.slice(orientStart, practice1));
  const ccp = parseElements(lines2.slice(ccpStart, practice2));

  // ---- QUESTIONS ----
  const qs = [];
  let cur = null;
  let last = null; // 'q' or option index
  for (const l0 of lines2.slice(qStart)) {
    const l = l0.trim();
    if (!l) continue;
    if (l === 'Child Protection practice questions') continue;
    let m;
    if ((m = l.match(/^(\d+)\.\s+(.*)$/))) { cur = { num: Number(m[1]), text: m[2], options: [] }; qs.push(cur); last = 'q'; }
    else if ((m = l.match(/^([A-D])\)\s+(.*)$/)) && cur) { cur.options.push({ letter: m[1], text: m[2] }); last = cur.options.length - 1; }
    else if (cur) { if (last === 'q') cur.text += ' ' + l; else cur.options[last].text += ' ' + l; }
  }
  qs.forEach((q) => { q.childProtection = q.num >= 41 && q.num <= 50; });
  if (qs.length !== 50) throw new Error('expected 50 questions, got ' + qs.length);

  // Expected words of everything shown on the course page, in order (used by the test suite)
  const flat = (els) => els.map((e) => {
    if (e.type === 'ul') return e.items.join(' ');
    if (e.type === 'table') return [e.header.join(' '), ...e.rows.map((r) => r.join(' '))].join(' ');
    return e.text;
  }).join(' ');
  const expectedWords = words([flat(part1), flat(orient), flat(ccp)].join(' '));

  const lessonTitles = (els) => els.filter((e) => e.type === 'lesson').map((e) => e.text);
  return { part1, orient, ccp, questions: qs, expectedWords, orientLessons: lessonTitles(orient), ccpLessons: lessonTitles(ccp) };
}

module.exports = { loadCourse, words };
