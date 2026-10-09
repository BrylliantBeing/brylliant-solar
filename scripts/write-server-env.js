/**
 * Build step: copies server secrets from the build environment into a PHP file
 * the PHP APIs can read, because Hostinger hands environment variables to the
 * build, not to PHP at request time.
 *
 * Writes dist/api/lib/env.php (never in git; dist/ is ignored). api/lib/ is
 * closed to the web by its .htaccess, and the file only returns an array, so
 * requesting it prints nothing even if the deny rule were lost.
 *
 * Set these in hPanel -> your site -> Environment variables:
 *   STAFF_USERS   staff sign-in; entries from `npm run staff:hash`, joined with ;
 *   DB_NAME, DB_USER, DB_PASSWORD   the MySQL database for saved quotes
 *   DB_HOST       optional, defaults to localhost
 *   MAIL_USER, MAIL_PASSWORD   the Hostinger mailbox the booking form sends from
 *   MAIL_TO       optional, where survey requests land (defaults to MAIL_USER)
 *   MAIL_HOST, MAIL_PORT       optional, default smtp.hostinger.com:465
 *
 * Missing variables only warn: the site still deploys, and the affected API
 * answers with a clear "not set up" error until they are set.
 */

const fs = require('fs');
const path = require('path');

const GROUPS = [
  { feature: 'staff sign-in', keys: ['STAFF_USERS'] },
  { feature: 'saved quotes', keys: ['DB_NAME', 'DB_USER', 'DB_PASSWORD'] },
  { feature: 'booking form email', keys: ['MAIL_USER', 'MAIL_PASSWORD'] },
];
const OPTIONAL = ['DB_HOST', 'MAIL_TO', 'MAIL_HOST', 'MAIL_PORT'];

// npm runs scripts from the project root.
const out = path.join(process.cwd(), 'dist', 'api', 'lib', 'env.php');

for (const g of GROUPS) {
  const missing = g.keys.filter((k) => !process.env[k]);
  if (missing.length > 0) console.warn(`write-server-env: ${missing.join(', ')} not set; ${g.feature} will be unavailable.`);
}

const present = [...GROUPS.flatMap((g) => g.keys), ...OPTIONAL].filter((k) => process.env[k]);
if (present.length === 0) {
  fs.rmSync(out, { force: true }); // never ship a stale file from an earlier build
  console.warn('write-server-env: no server variables set. No env.php written.');
  process.exit(0);
}

/** A PHP single-quoted string: only \ and ' need escaping. */
const php = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  '<?php\n// Generated at build time by scripts/write-server-env.js. Do not edit or commit.\nreturn [\n' +
    present.map((k) => `    ${php(k)} => ${php(process.env[k])},`).join('\n') +
    '\n];\n',
  { mode: 0o600 },
);
console.log(`write-server-env: wrote ${present.join(', ')} to dist/api/lib/env.php`);
