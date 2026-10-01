/**
 * Makes one STAFF_USERS entry for the /internal sign-in.
 *
 *   npm run staff:hash
 *
 * Asks for a username, display name and password (typed hidden, so it stays
 * out of shell history), then prints `username:Display Name:hash`. Paste that
 * into the STAFF_USERS environment variable in hPanel; separate several people
 * with ";". Verified by verify_staff_password() in public/api/lib/staff-session.php.
 */

const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

const ITERATIONS = 600000; // OWASP's PBKDF2-SHA256 recommendation

/** Piped input (scripts, tests) is read up front; a terminal is asked line by line. */
const piped = process.stdin.isTTY ? null : fs.readFileSync(0, 'utf8').split(/\r?\n/);
const rl = piped ? null : readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

let muted = false;
if (rl) {
  // While muted, echo nothing as the password is typed.
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => {
    if (!muted) write(s);
  };
  rl.on('SIGINT', () => fail('\nCancelled.'));
}

function ask(question, hidden = false) {
  if (piped) {
    process.stdout.write(question + '\n');
    return Promise.resolve(piped.shift() ?? '');
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      muted = false;
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden; // after the prompt is written, so the prompt still shows
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

(async () => {
  const username = (await ask('Username (lowercase, no spaces): ')).trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) fail('Use 2–40 letters, digits, ".", "_" or "-".');

  const name = (await ask('Display name: ')).trim() || username;
  if (/[:;]/.test(name)) fail('The display name cannot contain ":" or ";".');

  const password = await ask('Password (hidden): ', true);
  if (password.length < 10) fail('Use at least 10 characters.');
  if ((await ask('Password again (hidden): ', true)) !== password) fail('The passwords did not match.');
  rl?.close();

  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  const entry = `${username}:${name}:pbkdf2-sha256.${ITERATIONS}.${salt.toString('base64url')}.${hash.toString('base64url')}`;

  console.log('\nAdd this to STAFF_USERS in hPanel (join several with ";"), then redeploy:\n');
  console.log(entry);
})();
