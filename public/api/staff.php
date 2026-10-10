<?php
declare(strict_types=1);

/**
 * Brylliant Solar — staff accounts, managed from the owner dashboard. Owner only.
 *
 *   GET  /api/staff.php                                     -> { ok, accounts, me }
 *   POST {action: "create", username, name, role, password} -> { ok }
 *   POST {action: "update", username, name, role}           -> { ok }
 *   POST {action: "password", username, password}           -> { ok }  (signs them out everywhere)
 *   POST {action: "delete", username}                       -> { ok, removedFrom }
 *
 * Accounts made here live in the `staff` table. STAFF_USERS accounts (hPanel)
 * are listed but read-only here. Owners can't demote or remove themselves, so
 * there is always an owner left.
 */

require_once __DIR__ . '/lib/json-api.php';
require_once __DIR__ . '/lib/staff-session.php';
require_once __DIR__ . '/lib/db.php';

const MIN_PASSWORD = 10;

function clean_name(array $in): string {
    $name = text_field($in, 'name', 100);
    if ($name === '') {
        reply(422, ['ok' => false, 'error' => 'Give them a name.']);
    }
    return $name;
}

function clean_role(array $in): string {
    $role = (string) ($in['role'] ?? '');
    if (!in_array($role, STAFF_ROLES, true)) {
        reply(422, ['ok' => false, 'error' => 'Choose a role.']);
    }
    return $role;
}

function clean_password(array $in): string {
    $password = (string) ($in['password'] ?? '');
    if (mb_strlen($password) < MIN_PASSWORD || strlen($password) > 200) {
        reply(422, ['ok' => false, 'error' => 'Use a password of at least ' . MIN_PASSWORD . ' characters.']);
    }
    return $password;
}

$staff = require_owner();

try {
    $pdo = db();

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        $accounts = [];
        foreach (load_staff_users() as $username => $a) {
            $accounts[] = ['username' => $username, 'name' => $a['name'], 'role' => $a['role'], 'source' => $a['source']];
        }
        usort($accounts, static fn (array $a, array $b): int =>
            [array_search($a['role'], STAFF_ROLES, true), $a['name']] <=> [array_search($b['role'], STAFF_ROLES, true), $b['name']]);
        reply(200, ['ok' => true, 'accounts' => $accounts, 'me' => $staff['username']]);
    }

    $in = read_json_post(8 * 1024);
    $action = $in['action'] ?? '';
    $username = strtolower(trim((string) ($in['username'] ?? '')));
    $users = load_staff_users();

    if ($action === 'create') {
        if (!preg_match('/^[a-z0-9._-]{2,40}$/', $username)) {
            reply(422, ['ok' => false, 'error' => 'Usernames are 2–40 lowercase letters, digits, ".", "_" or "-".']);
        }
        if (isset($users[$username])) {
            reply(422, ['ok' => false, 'error' => 'That username is taken.']);
        }
        $pdo->prepare(
            'INSERT INTO staff (username, name, role, hash, created_by, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
        )->execute([$username, clean_name($in), clean_role($in), hash_staff_password(clean_password($in)), $staff['username'], $staff['username']]);
        reply(200, ['ok' => true]);
    }

    // Everything else changes an existing account, which must be one made here.
    if (!isset($users[$username])) {
        reply(404, ['ok' => false, 'error' => 'That account no longer exists.']);
    }
    if ($users[$username]['source'] !== 'db') {
        reply(422, ['ok' => false, 'error' => 'That account is in STAFF_USERS. Change it in hPanel and redeploy.']);
    }
    $self = $username === $staff['username'];

    if ($action === 'update') {
        $role = clean_role($in);
        if ($self && $role !== 'owner') {
            reply(422, ['ok' => false, 'error' => "You can't take the owner role off your own account."]);
        }
        $pdo->prepare('UPDATE staff SET name = ?, role = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE username = ?')
            ->execute([clean_name($in), $role, $staff['username'], $username]);
        reply(200, ['ok' => true]);
    }

    if ($action === 'password') {
        $hash = hash_staff_password(clean_password($in));
        $pdo->prepare('UPDATE staff SET hash = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE username = ?')
            ->execute([$hash, $staff['username'], $username]);
        if ($self) {
            // Keep the owner who changed it signed in on this device.
            $_SESSION['pw'] = password_stamp($hash);
        }
        reply(200, ['ok' => true]);
    }

    if ($action === 'delete') {
        if ($self) {
            reply(422, ['ok' => false, 'error' => "You can't remove your own account."]);
        }
        // They come off crews still to come; past bookings keep the record of who went.
        $pdo->beginTransaction();
        $stmt = $pdo->prepare(
            'DELETE es FROM event_staff es JOIN events e ON e.id = es.event_id
              WHERE es.username = ? AND e.end_at > UTC_TIMESTAMP()'
        );
        $stmt->execute([$username]);
        $removedFrom = $stmt->rowCount();
        $pdo->prepare('DELETE FROM staff WHERE username = ?')->execute([$username]);
        $pdo->commit();
        reply(200, ['ok' => true, 'removedFrom' => $removedFrom]);
    }

    reply(400, ['ok' => false, 'error' => 'Unknown action.']);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('staff.php: ' . $e->getMessage());
    reply(500, ['ok' => false, 'error' => 'The staff database is not reachable. Check the DB_* environment variables in hPanel.']);
}
