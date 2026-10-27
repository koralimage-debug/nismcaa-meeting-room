'use strict';
/**
 * Action plan helpers: importing the Excel workbook and the rule-based flags.
 */
const ExcelJS = require('exceljs');
const { DEPARTMENTS } = require('./config');

const RED_FILL = 'FFFCE4D6'; // shading the workbook uses for the final 4 weeks

function cellValue(c) {
  let v = c.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;       // formula cell: use the saved result
    else if (v.richText) v = v.richText.map((r) => r.text).join('');
    else if (v.text) v = v.text;
  }
  return v === undefined ? null : v;
}
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Read the workbook. Returns { departments: {name: rows[]}, about: [...], proposed }.
 * Formula columns (Days left, Time used, Points behind, Flag) are ignored: the site calculates them.
 */
async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const departments = {};
  for (const dep of DEPARTMENTS) {
    const ws = wb.getWorksheet(dep);
    if (!ws) throw new Error('Sheet missing in workbook: ' + dep);
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n < 6) return;
      const a = cellValue(row.getCell(1));
      if (typeof a === 'number') {
        const shaded = [1, 2, 3].some((i) => {
          const f = row.getCell(i).fill;
          return f && f.fgColor && f.fgColor.argb === RED_FILL;
        });
        const prog = Number(cellValue(row.getCell(8)) || 0);
        rows.push({
          type: 'task', no: a, title: text(cellValue(row.getCell(2))), owner: text(cellValue(row.getCell(3))),
          start: iso(cellValue(row.getCell(4))), deadline: iso(cellValue(row.getCell(5))),
          hardLimit: iso(cellValue(row.getCell(6))), status: text(cellValue(row.getCell(7))) || 'Not started',
          progress: Math.round(prog * 100), notes: text(cellValue(row.getCell(13))), final4: shaded ? 1 : 0,
        });
      } else if (typeof a === 'string' && a.trim()) {
        rows.push({ type: 'phase', title: a.trim() });
      }
    });
    departments[dep] = rows;
  }
  const readme = wb.getWorksheet('Read me');
  const about = [];
  readme.eachRow({ includeEmpty: true }, (row) => about.push(text(cellValue(row.getCell(1)))));
  const proposed = about[1] || '';
  return { departments, about, proposed };
}

/** Insert the workbook rows into the tasks table for one country. */
async function importPlan(db, file, country) {
  const { departments, about, proposed } = await readWorkbook(file);
  const ins = db.prepare(`INSERT INTO tasks (country, department, row_type, seq, title, owner, start_date, deadline, hard_limit,
      status, progress, notes, final4, sort) VALUES (@country,@department,@row_type,@seq,@title,@owner,@start,@deadline,@hard,@status,@progress,@notes,@final4,@sort)`);
  const counts = {};
  db.transaction(() => {
    for (const dep of DEPARTMENTS) {
      let sort = 0; counts[dep] = 0;
      for (const r of departments[dep]) {
        sort += 1;
        if (r.type === 'phase') {
          ins.run({ country, department: dep, row_type: 'phase', seq: null, title: r.title, owner: '', start: null, deadline: null, hard: null, status: '', progress: 0, notes: '', final4: 0, sort });
        } else {
          counts[dep] += 1;
          ins.run({ country, department: dep, row_type: 'task', seq: r.no, title: r.title, owner: r.owner, start: r.start, deadline: r.deadline, hard: r.hardLimit, status: r.status, progress: r.progress, notes: r.notes, final4: r.final4, sort });
        }
      }
    }
    const set = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)');
    set.run('plan_about', JSON.stringify(about));
    set.run('plan_proposed', proposed);
  })();
  return counts;
}

// ---------- flags ----------
const DAY = 86400000;
const dnum = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };

/**
 * Rule-based flag, same rules as the workbook:
 *  grey  : no start/deadline, or status On hold
 *  green : Done, or on pace
 *  red   : deadline passed and not Done, or 30+ points behind
 *  amber : 15 to 29 points behind
 * time used = (today - start) / (deadline - start), limited to 0..1
 * points behind = round(time used x 100 - % progress)
 */
function flagFor(task, today) {
  if (!task.deadline || !task.start_date || task.status === 'On hold') return { flag: 'grey', label: 'Not flagged', points: null, timeUsed: null };
  if (task.status === 'Done') return { flag: 'green', label: 'Green', points: 0, timeUsed: null };
  const t = dnum(today); const s = dnum(task.start_date); const d = dnum(task.deadline);
  let used;
  if (d > s) used = Math.max(0, Math.min(1, (t - s) / (d - s)));
  else used = t >= d ? 1 : 0;
  const points = Math.round(used * 100 - (task.progress || 0));
  let flag = 'green';
  if (t > d) flag = 'red';
  else if (points >= 30) flag = 'red';
  else if (points >= 15) flag = 'amber';
  return { flag, label: flag[0].toUpperCase() + flag.slice(1), points, timeUsed: used };
}

/** Summarize a list of task rows: counts and the owners who are behind. */
function summarize(tasks, today) {
  const s = { total: 0, done: 0, red: 0, amber: 0, green: 0, grey: 0, owners: [] };
  const owners = new Set();
  for (const t of tasks) {
    if (t.row_type !== 'task') continue;
    s.total += 1;
    if (t.status === 'Done') s.done += 1;
    const f = flagFor(t, today);
    s[f.flag] += 1;
    if (f.flag === 'red' || f.flag === 'amber') owners.add(t.owner_name || t.owner || 'No owner');
  }
  s.owners = [...owners].sort();
  return s;
}

module.exports = { readWorkbook, importPlan, flagFor, summarize };
