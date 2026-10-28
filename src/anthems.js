'use strict';
// National anthem audio: optional files in public/audio/<code>.mp3 and public/audio/CREDITS.md.
// Everything degrades quietly when a file is absent (no button, no credits link).
const fs = require('node:fs');
const path = require('node:path');

const dir = () => process.env.ANTHEM_DIR || path.join(__dirname, '..', 'public', 'audio');
const NAMES = { us: 'United States', ng: 'Nigeria', ca: 'Canada', ae: 'United Arab Emirates', gb: 'United Kingdom', au: 'Australia' };

function has(code) {
  if (!NAMES[code]) return false;
  try { return fs.statSync(path.join(dir(), code + '.mp3')).size > 0; } catch { return false; }
}
function credits() {
  try { return fs.readFileSync(path.join(dir(), 'CREDITS.md'), 'utf8').slice(0, 20000); } catch { return ''; }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = '<svg class="spk" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/><path class="w1" d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="w2" d="M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function codeOf(countryOrCode, FLAG) { return NAMES[countryOrCode] ? countryOrCode : (FLAG || {})[countryOrCode]; }
// Attributes that make a flag tappable (empty string when that country has no audio file).
function attrs(countryOrCode, FLAG) {
  const code = codeOf(countryOrCode, FLAG);
  if (!code || !has(code)) return '';
  return ` data-anthem="${code}" data-name="${esc(NAMES[code])}" role="button" tabindex="0" title="Tap to hear the anthem of ${esc(NAMES[code])}" aria-label="Play anthem of ${esc(NAMES[code])}"`;
}
// A small flag image for a country label that plays the anthem when tapped.
function flag(countryOrCode, FLAG) {
  const code = codeOf(countryOrCode, FLAG);
  if (!code) return '';
  return `<img class="cflag${has(code) ? ' playable' : ''}" src="/static/img/flags/${code}.svg" alt="" width="24" height="16"${attrs(code)}> `;
}
// The hint line shown above flag rows, only when at least one anthem file exists.
function hint() {
  if (!Object.keys(NAMES).some(has)) return '';
  return `<p class="anthem-hint" data-anthem-hint hidden>${ICON}<span>Tap your flag to hear your anthem</span></p>`;
}
module.exports = { has, credits, attrs, flag, hint, NAMES };
