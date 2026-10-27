'use strict';
/** Tiny CSV writer. Prefixes risky cells so Excel does not run them as formulas. Adds a BOM so Excel reads UTF-8. */
function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(header, rows) {
  return '\uFEFF' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
function sendCsv(res, filename, header, rows) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' });
  res.send(toCsv(header, rows));
}
module.exports = { toCsv, sendCsv };
