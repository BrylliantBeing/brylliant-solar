<?php
declare(strict_types=1);

/**
 * Brylliant Solar — staff sign-in for the /internal pages.
 *
 *   GET  /api/auth.php                      -> { ok, user } or 401
 *   POST /api/auth.php {action: "login", username, password}
 *   POST /api/auth.php {action: "logout"}
 *
 * Same-origin only: it sends no CORS headers, and POSTs must be JSON, so another
 * site cannot drive it from a visitor's browser. Accounts come from the
 * STAFF_USERS environment variable (see lib/staff-session.php).
 */

require_once __DIR__ . '/lib/staff-session.php';

/** Failed sign-ins allowed per connection in LOCKOUT_WINDOW seconds. */
const MAX_FAILURES = 8;
const LOCKOUT_WINDOW = 900;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

function reply(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

/* ------------------------------------------------------------------- read */

$method = $_SERVER['REQUEST_METHOD'] ?? '';

try {
    if ($method === 'GET') {
        $staff = current_staff();
        if ($staff === null) {
            reply(401, ['ok' => false, 'error' => 'Not signed in.']);
        }
        reply(200, ['ok' => true, 'user' => $staff]);
    }
    if ($method !== 'POST') {
        reply(405, ['ok' => false, 'error' => 'Method not allowed.']);
    }

    $type = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($type, 'application/json')) {
        reply(415, ['ok' => false, 'error' => 'Expected JSON.']);
    }
    $raw = file_get_contents('php://input');
    $in = ($raw !== false && strlen($raw) <= 2000) ? json_decode($raw, true) : null;
    if (!is_array($in)) {
        reply(400, ['ok' => false, 'error' => 'Could not read the request.']);
    }

    /* --------------------------------------------------------------- logout */

    if (($in['action'] ?? '') === 'logout') {
        end_staff_session();
        reply(200, ['ok' => true]);
    }
    if (($in['action'] ?? '') !== 'login') {
        reply(400, ['ok' => false, 'error' => 'Unknown action.']);
    }

    /* ---------------------------------------------------------------- login */

    $ip    = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $stamp = sys_get_temp_dir() . '/bs-staff-login-' . hash('sha256', $ip) . '.txt';
    $fails = [];
    if (is_readable($stamp)) {
        $fails = array_values(array_filter(
            array_map('intval', explode(',', (string) file_get_contents($stamp))),
            static fn (int $t): bool => $t > time() - LOCKOUT_WINDOW
        ));
    }
    if (count($fails) >= MAX_FAILURES) {
        reply(429, ['ok' => false, 'error' => 'Too many failed attempts. Try again in 15 minutes.']);
    }

    $username = strtolower(trim((string) ($in['username'] ?? '')));
    $password = (string) ($in['password'] ?? '');
    $users = load_staff_users();
    $account = $users[$username] ?? null;

    // Hash something even for an unknown username, so the response time does
    // not reveal which usernames exist.
    $hash = is_array($account) ? $account['hash'] : STAFF_DUMMY_HASH;
    $valid = verify_staff_password($password, $hash) && is_array($account) && $password !== '';

    if (!$valid) {
        $fails[] = time();
        @file_put_contents($stamp, implode(',', $fails), LOCK_EX);
        reply(401, ['ok' => false, 'error' => 'Wrong username or password.']);
    }

    @unlink($stamp);
    start_staff_session();
    session_regenerate_id(true);
    $_SESSION['staff'] = $username;
    $_SESSION['pw'] = password_stamp($account['hash']);
    $_SESSION['signed_in_at'] = time();
    $_SESSION['seen_at'] = time();

    reply(200, ['ok' => true, 'user' => [
        'username' => $username,
        'name'     => (string) ($account['name'] ?? $username),
        'role'     => (string) ($account['role'] ?? 'owner'),
    ]]);
} catch (Throwable $e) {
    error_log('auth.php: ' . $e->getMessage());
    reply(500, ['ok' => false, 'error' => 'Sign-in is not set up on the server yet.']);
}
