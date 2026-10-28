'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./helpers');

let app, dir;
before(async () => { app = await H.startApp(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthems-')); });
after(async () => { delete process.env.ANTHEM_DIR; fs.rmSync(dir, { recursive: true, force: true }); await app.close(); });

test('anthems: with no audio files there are no flag players, no hint and no credits link; pages still work', async () => {
  process.env.ANTHEM_DIR = path.join(dir, 'missing');
  const c = app.client();
  for (const url of ['/', '/sign-up']) {
    const r = await c.get(url);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.text, /data-anthem/);
    assert.doesNotMatch(r.text, /Anthem credits/);
  }
  const cr = await c.get('/anthem-credits');
  assert.equal(cr.status, 302);
});

test('anthems: a flag becomes tappable only when its own file exists; credits page shows CREDITS.md as plain text', async () => {
  process.env.ANTHEM_DIR = dir;
  fs.writeFileSync(path.join(dir, 'us.mp3'), 'ID3 fake');
  fs.writeFileSync(path.join(dir, 'CREDITS.md'), '# Credits\nUS anthem <b>test</b>');
  const c = app.client();
  const home = (await c.get('/')).text;
  assert.match(home, /data-anthem="us"/);
  assert.doesNotMatch(home, /data-anthem="ng"/);
  assert.match(home, /Tap your flag to hear your anthem/);
  assert.match(home, /href="\/anthem-credits"/);
  const su = (await c.get('/sign-up')).text;
  assert.match(su, /class="cflag playable"[^>]*data-anthem="us"/);
  const cr = await c.get('/anthem-credits');
  assert.equal(cr.status, 200);
  assert.match(cr.text, /US anthem &lt;b&gt;test&lt;\/b&gt;/);
  assert.doesNotMatch(cr.text, /<b>test<\/b>/);
});
