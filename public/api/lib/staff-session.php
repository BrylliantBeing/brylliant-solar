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
 *     username:Display Name:hash:role;username2:Other Name:hash:role
 *
 * Make each entry with `npm run staff:hash`. Hashes are PBKDF2-SHA256 written
 * with "." separators, so they contain no "$" for a shell or .env parser to eat.
 * The role is one of STAFF_ROLES; an entry without one is an owner, so accounts
 * made before roles existed keep full access.
 */

require_once __DIR__ . '/server-env.php';

const STAFF_SESSION_NAME = 'bs_staff';
/** Signed out this long after signing in, however active. */
const STAFF_MAX_AGE = 12 * 3600;
/** Signed out after this long without a request. */
const STAFF_IDLE = 2 * 3600;

/** Checked for unknown usernames, so timing doesn't reveal which ones exist. */
const STAFF_DUMMY_HASH = 'pbkdf2-sha256.600000.PtplnUKCBMM5G5YZRGdXQw.lD4aMPe1xllIB0Or1TN6AJ2RHwDx4HuBTJRDTKA5OGE';

/** Must match StaffRole in src/lib/staff-session.tsx. */
const STAFF_ROLES = ['owner', 'lead_installer', 'installer', 'electrician'];

/** Iterations for new hashes; must match ITERATIONS in scripts/staff-hash.js. */
const STAFF_HASH_ITERATIONS = 600000;

/**
 * Every account: the ones the owner made on the dashboard (MySQL `staff`
 * table) plus STAFF_USERS. STAFF_USERS wins a clash and is the way back in if
 * the database is down.
 *
 * Loaded once per request; $fresh re-reads them after staff.php changes one.
 *
 * @return array<string, array{name: string, hash: string, role: string, source: string}> username => account
 */
function load_staff_users(bool $fresh = false): array {
    static $cache = null;
    if ($cache !== null && !$fresh) {
        return $cache;
    }
    $users = db_staff_users();
    foreach (preg_split('/[;\r\n]+/', server_env('STAFF_USERS')) ?: [] as $entry) {
        $parts = array_map('trim', explode(':', $entry));
        if (count($parts) < 3 || count($parts) > 4 || $parts[0] === '' || $parts[2] === '') {
            continue; // blank or malformed entry
        }
        $role = strtolower($parts[3] ?? 'owner');
        if (!in_array($role, STAFF_ROLES, true)) {
            continue; // a typo in the role must not grant anything
        }
        $users[strtolower($parts[0])] = [
            'name'   => $parts[1] !== '' ? $parts[1] : $parts[0],
            'hash'   => $parts[2],
            'role'   => $role,
            'source' => 'env',
        ];
    }
    if ($users === []) {
        throw new RuntimeException('No staff accounts: STAFF_USERS is not set in the hosting environment');
    }
    return $cache = $users;
}

/** Accounts from the `staff` table; none if the database isn't set up or reachable. */
function db_staff_users(): array {
    if (server_env('DB_NAME') === '') {
        return [];
    }
    try {
        require_once __DIR__ . '/db.php';
        $users = [];
        foreach (db()->query('SELECT username, name, role, hash FROM staff')->fetchAll() as $r) {
            if (in_array($r['role'], STAFF_ROLES, true)) {
                $users[$r['username']] = ['name' => $r['name'], 'hash' => $r['hash'], 'role' => $r['role'], 'source' => 'db'];
            }
        }
        return $users;
    } catch (Throwable $e) {
        error_log('staff-session: staff table unavailable: ' . $e->getMessage());
        return [];
    }
}

function base64url_encode(string $s): string {
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

/** A new "pbkdf2-sha256.<iterations>.<salt>.<hash>", the format verify_staff_password() checks. */
function hash_staff_password(string $password): string {
    $salt = random_bytes(16);
    $hash = hash_pbkdf2('sha256', $password, $salt, STAFF_HASH_ITERATIONS, 32, true);
    return 'pbkdf2-sha256.' . STAFF_HASH_ITERATIONS . '.' . base64url_encode($salt) . '.' . base64url_encode($hash);
}

/** Kept in the session; when the password changes it no longer matches, which signs that person out. */
function password_stamp(string $hash): string {
    return hash('sha256', $hash);
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
 * @return array{username: string, name: string, role: string}|null
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
        // The password changed since sign-in (a reset on the dashboard): sign out everywhere.
        || !hash_equals(password_stamp($users[$username]['hash']), (string) ($_SESSION['pw'] ?? ''))
        || $now - (int) ($_SESSION['signed_in_at'] ?? 0) > STAFF_MAX_AGE
        || $now - (int) ($_SESSION['seen_at'] ?? 0) > STAFF_IDLE
    ) {
        end_staff_session();
        return null;
    }
    $_SESSION['seen_at'] = $now;
    return [
        'username' => $username,
        'name'     => (string) ($users[$username]['name'] ?? $username),
        'role'     => (string) ($users[$username]['role'] ?? 'owner'),
    ];
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

/** Like require_staff(), and also stops with a 403 unless the account is an owner. */
function require_owner(): array {
    $staff = require_staff();
    if ($staff['role'] !== 'owner') {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode(['ok' => false, 'error' => 'Only the owner can do that.']);
        exit;
    }
    return $staff;
}

/**
 * Everyone who can be put on a job, for crew pickers. Never includes hashes.
 *
 * @return list<array{username: string, name: string, role: string}>
 */
function staff_directory(): array {
    $out = [];
    foreach (load_staff_users() as $username => $account) {
        $out[] = ['username' => $username, 'name' => $account['name'], 'role' => $account['role']];
    }
    return $out;
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
