<?php
declare(strict_types=1);

/**
 * Brylliant Solar — staff session helpers, shared by every /internal API.
 *
 * Not an endpoint: lib/.htaccess denies direct requests. Include it and call
 * require_staff() at the top of any script that must only answer signed-in staff.
 *
 * Accounts come from the STAFF_USERS environment variable in hPanel, never git:
 *
 *     username:Display Name:hash;username2:Other Name:hash
 *
 * Make each entry with `npm run staff:hash`. Hashes are PBKDF2-SHA256 written
 * with "." separators, so they contain no "$" for a shell or .env parser to eat.
 */

require_once __DIR__ . '/server-env.php';

const STAFF_SESSION_NAME = 'bs_staff';
/** Signed out this long after signing in, however active. */
const STAFF_MAX_AGE = 12 * 3600;
/** Signed out after this long without a request. */
const STAFF_IDLE = 2 * 3600;

/** Checked for unknown usernames, so timing doesn't reveal which ones exist. */
const STAFF_DUMMY_HASH = 'pbkdf2-sha256.600000.PtplnUKCBMM5G5YZRGdXQw.lD4aMPe1xllIB0Or1TN6AJ2RHwDx4HuBTJRDTKA5OGE';

/** @return array<string, array{name: string, hash: string}> username => account */
function load_staff_users(): array {
    $users = [];
    foreach (preg_split('/[;\r\n]+/', server_env('STAFF_USERS')) ?: [] as $entry) {
        $parts = array_map('trim', explode(':', $entry));
        if (count($parts) !== 3 || $parts[0] === '' || $parts[2] === '') {
            continue; // blank or malformed entry
        }
        $users[strtolower($parts[0])] = ['name' => $parts[1] !== '' ? $parts[1] : $parts[0], 'hash' => $parts[2]];
    }
    if ($users === []) {
        throw new RuntimeException('STAFF_USERS is not set in the hosting environment');
    }
    return $users;
}

function base64url_decode(string $s): string|false {
    return base64_decode(str_pad(strtr($s, '-_', '+/'), (int) ceil(strlen($s) / 4) * 4, '='), true);
}

/** Checks a password against "pbkdf2-sha256.<iterations>.<salt>.<hash>" in constant time. */
function verify_staff_password(string $password, string $stored): bool {
    $parts = explode('.', $stored);
    if (count($parts) !== 4 || $parts[0] !== 'pbkdf2-sha256') {
        return false;
    }
    $iterations = (int) $parts[1];
    $salt = base64url_decode($parts[2]);
    $expected = base64url_decode($parts[3]);
    if ($iterations < 100000 || $iterations > 5000000 || $salt === false || $expected === false || strlen($expected) !== 32) {
        return false;
    }
    return hash_equals($expected, hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true));
}

function start_staff_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off';
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) STAFF_MAX_AGE);
    session_name(STAFF_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $https,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

/**
 * The signed-in account, or null. Also enforces the age and idle limits, and
 * drops the session if the account has since been removed from the config.
 *
 * @return array{username: string, name: string}|null
 */
function current_staff(): ?array {
    start_staff_session();
    $username = $_SESSION['staff'] ?? null;
    if (!is_string($username)) {
        return null;
    }
    $now = time();
    $users = load_staff_users();
    if (
        !isset($users[$username])
        || $now - (int) ($_SESSION['signed_in_at'] ?? 0) > STAFF_MAX_AGE
        || $now - (int) ($_SESSION['seen_at'] ?? 0) > STAFF_IDLE
    ) {
        end_staff_session();
        return null;
    }
    $_SESSION['seen_at'] = $now;
    return ['username' => $username, 'name' => (string) ($users[$username]['name'] ?? $username)];
}

/** Stops the script with a 401 unless a staff member is signed in. */
function require_staff(): array {
    $staff = current_staff();
    if ($staff === null) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode(['ok' => false, 'error' => 'Sign in required.']);
        exit;
    }
    return $staff;
}

function end_staff_session(): void {
    start_staff_session();
    $_SESSION = [];
    $p = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires'  => time() - 3600,
        'path'     => $p['path'],
        'secure'   => $p['secure'],
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_destroy();
}
