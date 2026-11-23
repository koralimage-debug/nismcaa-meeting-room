'use strict';
/** Start a temporary Meeting Room instance for reset-flow screenshots. Prints {base,email} on stdout. */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const mail = require('../src/mail');
const sec = require('../src/security');
const { now } = require('../src/db');

(async () => {
  const outboxPath = process.env.MAIL_OUT || path.join(os.tmpdir(), 'nmr-reset-outbox.json');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-shots-'));
  const config = loadConfig({ DATA_DIR: dataDir, QUIET: '1', SCRYPT_N: '1024', PUBLIC_URL: '' });
  config.limits = { signupPerHour: 1e6, loginPer15Min: 1e6, claimPer15Min: 1e6, verifyPerMin: 1e6, forgotPer15Min: 1e6, forgotEmailPerHour: 1e6, resetPer15Min: 1e6 };
  const a = await createApp(config);
  const server = http.createServer(a.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  mail.configure({ quiet: true, publicUrl: base, displayTz: 'America/New_York' });
  const outbox = [];
  mail._setTransport(async (msg) => {
    outbox.push(msg);
    fs.writeFileSync(outboxPath, JSON.stringify(outbox, null, 2));
    return { ok: true, fake: true };
  });
  const email = 'emily.carter@example.test';
  const hash = await sec.hashPassword('correct-horse-battery', config);
  a.db.prepare(
    "INSERT INTO users(email,name,phone,pw_hash,role,status,country_chosen,age_confirmed,created_at) VALUES (?,?,?,?, 'volunteer', 'applicant', ?, 1, ?)"
  ).run(email, 'Emily Carter', '+1 555 010 0000', hash, 'United States', now());
  process.stdout.write(JSON.stringify({ base, email, outboxPath, dataDir }) + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
