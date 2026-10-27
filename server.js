'use strict';
/** Starts the web server. Usage: node server.js   (see README.md for environment variables) */
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

(async () => {
  const config = loadConfig();
  const { app, claimCodes } = await createApp(config);
  if (claimCodes) {
    console.log('\n=== FIRST START: one-time admin claim codes (shown once, also saved in %s/ADMIN_CLAIM_CODES.txt) ===', config.dataDir);
    for (const [email, code] of Object.entries(claimCodes)) console.log(`  ${email}  ->  ${code}`);
    console.log('  Each admin opens /admin/claim, enters their own e-mail and code, and chooses a password.\n');
  }
  app.listen(config.port, () => console.log(`NISMCAA Meeting Room listening on port ${config.port} (data: ${config.dataDir})`));
})().catch((e) => { console.error(e); process.exit(1); });
