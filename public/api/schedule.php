<?php
declare(strict_types=1);

/**
 * Brylliant Solar — the staff calendar.
 *
 *   GET  /api/schedule.php?from=ISO&to=ISO  -> { ok, events, directory }
 *        The owner gets every event and the full project; everyone else only the
 *        events they are on, with what they need on site (name, phone, address)
 *        and no bills, prices or jobs.
 *   POST {action: "book", projectId, jobId?, replaceBatch?, events: [{kind, start, end, allDay, staff: [{username, role}]}]}
 *        -> { ok, batch }   Owner only. With replaceBatch, those events are removed first (a move).
 *   POST {action: "unschedule", batch}      -> { ok }   Owner only.
 *   POST {action: "assign", id, staff}      -> { ok }   Owner only; replaces one event's crew.
 *
 * Booking never refuses a clash: double-bookings and the like are warnings in the app.
 */

require_once __DIR__ . '/lib/json-api.php';
require_once __DIR__ . '/lib/staff-session.php';
require_once __DIR__ . '/lib/db.php';

/** Kinds staff can book here; permit markers come from projects.php. */
const BOOKABLE = ['survey', 'install', 'inspection'];
const MAX_EVENTS_PER_BOOKING = 60;

/** [{username, role}] checked against the staff list; null if anyone isn't on it. */
function clean_staff(mixed $list, array $people): ?array {
    $out = [];
    foreach (is_array($list) ? array_slice($list, 0, 20) : [] as $s) {
        $username = strtolower(trim((string) ($s['username'] ?? '')));
        $role = (string) ($s['role'] ?? '');
        if (!isset($people[$username])) {
            return null;
        }
        $out[$username] = ['username' => $username, 'role' => in_array($role, STAFF_ROLES, true) ? $role : $people[$username]['role']];
    }
    return array_values($out);
}

function add_staff(PDO $pdo, int $eventId, array $staff): void {
    $stmt = $pdo->prepare('INSERT INTO event_staff (event_id, username, role) VALUES (?, ?, ?)');
    foreach ($staff as $s) {
        $stmt->execute([$eventId, $s['username'], $s['role']]);
    }
}

$staff = require_staff();
$owner = $staff['role'] === 'owner';
$people = array_column(staff_directory(), null, 'username');

try {
    $pdo = db();

    /* ------------------------------------------------------------- read */

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        $from = to_utc_datetime($_GET['from'] ?? null);
        $to = to_utc_datetime($_GET['to'] ?? null);
        if ($from === null || $to === null || $from >= $to) {
            reply(422, ['ok' => false, 'error' => 'Give a from and to time.']);
        }
        $sql = 'SELECT e.*, p.customer, p.phone, p.address, p.email, p.monthly_bill, p.property, p.free_dates_json
                  FROM events e JOIN projects p ON p.id = e.project_id
                 WHERE e.start_at < :to AND e.end_at > :from';
        $args = ['from' => $from, 'to' => $to];
        if (!$owner) {
            $sql .= ' AND e.id IN (SELECT event_id FROM event_staff WHERE username = :me)';
            $args['me'] = $staff['username'];
        }
        $stmt = $pdo->prepare($sql . ' ORDER BY e.start_at LIMIT 2000');
        $stmt->execute($args);
        $rows = $stmt->fetchAll();

        $crew = [];
        if ($rows) {
            $ids = implode(',', array_map(static fn (array $r): int => (int) $r['id'], $rows));
            foreach ($pdo->query("SELECT event_id, username, role FROM event_staff WHERE event_id IN ($ids)")->fetchAll() as $s) {
                $crew[(int) $s['event_id']][] = [
                    'username' => $s['username'],
                    'role'     => $s['role'],
                    'name'     => $people[$s['username']]['name'] ?? $s['username'],
                ];
            }
        }

        $events = array_map(static function (array $r) use ($crew, $owner): array {
            $project = ['id' => (int) $r['project_id'], 'customer' => $r['customer'], 'phone' => $r['phone'], 'address' => $r['address']];
            if ($owner) {
                $project += [
                    'email'       => $r['email'],
                    'monthlyBill' => $r['monthly_bill'] !== null ? (float) $r['monthly_bill'] : null,
                    'property'    => $r['property'],
                    'freeDates'   => json_decode($r['free_dates_json'], true) ?: [],
                ];
            }
            return [
                'id'      => (int) $r['id'],
                'batch'   => $r['batch'],
                'jobId'   => $owner && $r['job_id'] !== null ? (int) $r['job_id'] : null,
                'kind'    => $r['kind'],
                'start'   => utc_iso($r['start_at']),
                'end'     => utc_iso($r['end_at']),
                'allDay'  => (bool) $r['all_day'],
                'notes'   => (string) ($r['notes'] ?? ''),
                'staff'   => $crew[(int) $r['id']] ?? [],
                'project' => $project,
            ];
        }, $rows);

        reply(200, ['ok' => true, 'events' => $events, 'directory' => array_values($people)]);
    }

    /* ------------------------------------------------------------ write */

    $in = read_json_post(256 * 1024);
    if (!$owner) {
        reply(403, ['ok' => false, 'error' => 'Only the owner can change the calendar.']);
    }
    $action = $in['action'] ?? '';

    if ($action === 'unschedule') {
        $pdo->prepare('DELETE FROM events WHERE batch = ?')->execute([(string) ($in['batch'] ?? '')]);
        reply(200, ['ok' => true]);
    }

    if ($action === 'assign') {
        $crewList = clean_staff($in['staff'] ?? [], $people);
        if ($crewList === null) {
            reply(422, ['ok' => false, 'error' => 'Someone in that crew is not on the staff list.']);
        }
        $id = (int) ($in['id'] ?? 0);
        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM event_staff WHERE event_id = ?')->execute([$id]);
        add_staff($pdo, $id, $crewList);
        $pdo->prepare('UPDATE events SET updated_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$id]);
        $pdo->commit();
        reply(200, ['ok' => true]);
    }

    if ($action !== 'book') {
        reply(400, ['ok' => false, 'error' => 'Unknown action.']);
    }

    $projectId = (int) ($in['projectId'] ?? 0);
    $jobId = (int) ($in['jobId'] ?? 0) ?: null;
    $stmt = $pdo->prepare('SELECT 1 FROM projects WHERE id = ?');
    $stmt->execute([$projectId]);
    if (!$stmt->fetch()) {
        reply(404, ['ok' => false, 'error' => 'That project no longer exists.']);
    }
    if ($jobId !== null) {
        $stmt = $pdo->prepare('SELECT 1 FROM jobs WHERE id = ? AND project_id = ?');
        $stmt->execute([$jobId, $projectId]);
        if (!$stmt->fetch()) {
            reply(404, ['ok' => false, 'error' => 'That job no longer exists.']);
        }
    }

    $events = [];
    $list = $in['events'] ?? null;
    if (!is_array($list) || $list === [] || count($list) > MAX_EVENTS_PER_BOOKING) {
        reply(422, ['ok' => false, 'error' => 'Nothing to book.']);
    }
    foreach ($list as $e) {
        $kind = (string) ($e['kind'] ?? '');
        $start = to_utc_datetime($e['start'] ?? null);
        $end = to_utc_datetime($e['end'] ?? null);
        $crewList = clean_staff($e['staff'] ?? [], $people);
        if (!in_array($kind, BOOKABLE, true) || $start === null || $end === null || $start >= $end) {
            reply(422, ['ok' => false, 'error' => 'One of the time slots is not valid.']);
        }
        if ($crewList === null) {
            reply(422, ['ok' => false, 'error' => 'Someone in that crew is not on the staff list.']);
        }
        if ($kind !== 'survey' && $jobId === null) {
            reply(422, ['ok' => false, 'error' => 'An installation must belong to a job.']);
        }
        $events[] = [$kind, $start, $end, !empty($e['allDay']) ? 1 : 0, $crewList];
    }

    $batch = bin2hex(random_bytes(16));
    $pdo->beginTransaction();
    if (is_string($in['replaceBatch'] ?? null) && $in['replaceBatch'] !== '') {
        $pdo->prepare('DELETE FROM events WHERE batch = ?')->execute([$in['replaceBatch']]);
    }
    $insert = $pdo->prepare(
        'INSERT INTO events (batch, project_id, job_id, kind, start_at, end_at, all_day, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
    );
    foreach ($events as [$kind, $start, $end, $allDay, $crewList]) {
        $insert->execute([$batch, $projectId, $kind === 'survey' ? null : $jobId, $kind, $start, $end, $allDay, $staff['username']]);
        add_staff($pdo, (int) $pdo->lastInsertId(), $crewList);
    }
    $pdo->commit();
    reply(200, ['ok' => true, 'batch' => $batch]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('schedule.php: ' . $e->getMessage());
    reply(500, ['ok' => false, 'error' => 'The calendar database is not reachable. Check the DB_* environment variables in hPanel.']);
}
