<?php
declare(strict_types=1);

/**
 * Brylliant Solar — projects (one customer's pipeline) and their permits. Owner only.
 *
 *   GET  /api/projects.php      -> { ok, projects, jobs, permits, directory }
 *   POST {action: "save", id?, customer, phone, email, address, monthlyBill, property, freeDates, timePref, notes}
 *        -> { ok, project }   (without id: a new manual project)
 *   POST {action: "close", id, closed}            -> { ok }
 *   POST {action: "reject", id, reason}           -> { ok, unscheduled }  (takes off any survey still to come)
 *   POST {action: "restore", id}                  -> { ok }  (back to active)
 *   POST {action: "permit", projectId, step, doneOn|null, owner, notes}  -> { ok }
 *        Setting "submitted" or "approved" also puts a marker on the calendar.
 */

require_once __DIR__ . '/lib/json-api.php';
require_once __DIR__ . '/lib/staff-session.php';
require_once __DIR__ . '/lib/db.php';

const PERMIT_STEPS = ['docs_prepared', 'submitted', 'approved'];
/** Must match TIMES in src/app/(site)/book.tsx and public/api/quote.php. */
const TIME_PREFS = ['Morning', 'Afternoon', 'Any time'];

function project_row(array $r): array {
    return [
        'id'          => (int) $r['id'],
        'customer'    => $r['customer'],
        'phone'       => $r['phone'],
        'email'       => $r['email'],
        'address'     => $r['address'],
        'monthlyBill' => $r['monthly_bill'] !== null ? (float) $r['monthly_bill'] : null,
        'property'    => $r['property'],
        'freeDates'   => json_decode($r['free_dates_json'], true) ?: [],
        'timePref'    => $r['time_pref'],
        'source'      => $r['source'],
        'notes'       => (string) ($r['notes'] ?? ''),
        'status'      => $r['status'],
        'rejectReason' => (string) ($r['reject_reason'] ?? ''),
        'createdAt'   => utc_iso($r['created_at']),
        'surveyAt'    => utc_iso($r['survey_at'] ?? null),
    ];
}

const PROJECT_SELECT = 'SELECT p.*,
    (SELECT MIN(e.start_at) FROM events e WHERE e.project_id = p.id AND e.kind = \'survey\') AS survey_at
    FROM projects p';

/** Midnight of a Manila calendar day, plus $days, as a UTC DATETIME. */
function manila_day_utc(string $ymd, int $days = 0): string {
    return (new DateTimeImmutable($ymd . ' 00:00:00', new DateTimeZone('Asia/Manila')))
        ->modify("+$days days")
        ->setTimezone(new DateTimeZone('UTC'))
        ->format('Y-m-d H:i:s');
}

$staff = require_owner();

try {
    $pdo = db();

    /* ------------------------------------------------------------- read */

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        $projects = array_map('project_row', $pdo->query(PROJECT_SELECT . ' ORDER BY p.created_at DESC LIMIT 500')->fetchAll());
        $jobs = array_map(static fn (array $r): array => [
            'id'         => (int) $r['id'],
            'projectId'  => (int) $r['project_id'],
            'quoteId'    => $r['quote_id'] !== null ? (int) $r['quote_id'] : null,
            'systemType' => $r['system_type'],
            'panels'     => (int) $r['panels'],
            'total'      => (float) $r['total'],
            'status'     => $r['status'],
            'updatedAt'  => utc_iso($r['updated_at']),
            'installAt'  => utc_iso($r['install_at']),
        ], $pdo->query(
            'SELECT j.id, j.project_id, j.quote_id, j.system_type, j.panels, j.total, j.status, j.updated_at,
                (SELECT MIN(e.start_at) FROM events e WHERE e.job_id = j.id AND e.kind = \'install\') AS install_at
             FROM jobs j ORDER BY j.updated_at DESC LIMIT 500'
        )->fetchAll());
        $permits = array_map(static fn (array $r): array => [
            'projectId' => (int) $r['project_id'],
            'step'      => $r['step'],
            'doneOn'    => $r['done_on'],
            'owner'     => $r['owner_username'],
            'notes'     => (string) ($r['notes'] ?? ''),
        ], $pdo->query('SELECT * FROM permits')->fetchAll());

        reply(200, [
            'ok'        => true,
            'projects'  => $projects,
            'jobs'      => $jobs,
            'permits'   => $permits,
            'directory' => staff_directory(),
        ]);
    }

    $in = read_json_post(64 * 1024);
    $action = $in['action'] ?? '';

    /* ------------------------------------------------------------- save */

    if ($action === 'save') {
        $customer = text_field($in, 'customer', 200);
        if ($customer === '') {
            reply(422, ['ok' => false, 'error' => 'Give the project a customer name.']);
        }
        $dates = [];
        foreach (array_slice(is_array($in['freeDates'] ?? null) ? $in['freeDates'] : [], 0, 60) as $d) {
            if (($d = iso_date($d)) !== null) {
                $dates[$d] = true;
            }
        }
        $dates = array_keys($dates);
        sort($dates);
        $bill = $in['monthlyBill'] ?? null;
        $timePref = text_field($in, 'timePref', 40);
        $values = [
            'customer'        => $customer,
            'phone'           => text_field($in, 'phone', 40),
            'email'           => text_field($in, 'email', 200),
            'address'         => text_field($in, 'address', 300),
            'monthly_bill'    => is_numeric($bill) && (float) $bill > 0 ? (float) $bill : null,
            'property'        => text_field($in, 'property', 40),
            'free_dates_json' => json_encode($dates),
            'time_pref'       => in_array($timePref, TIME_PREFS, true) ? $timePref : '',
            'notes'           => text_field($in, 'notes', 4000),
            'updated_by'      => $staff['username'],
        ];

        $id = (int) ($in['id'] ?? 0);
        if ($id > 0) {
            $stmt = $pdo->prepare(
                'UPDATE projects SET customer = :customer, phone = :phone, email = :email, address = :address,
                    monthly_bill = :monthly_bill, property = :property, free_dates_json = :free_dates_json,
                    time_pref = :time_pref, notes = :notes, updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
                 WHERE id = :id'
            );
            $stmt->execute($values + ['id' => $id]);
        } else {
            $stmt = $pdo->prepare(
                'INSERT INTO projects (customer, phone, email, address, monthly_bill, property, free_dates_json,
                    time_pref, notes, source, created_by, updated_by, created_at, updated_at)
                 VALUES (:customer, :phone, :email, :address, :monthly_bill, :property, :free_dates_json,
                    :time_pref, :notes, \'manual\', :created_by, :updated_by, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
            );
            $stmt->execute($values + ['created_by' => $staff['username']]);
            $id = (int) $pdo->lastInsertId();
        }
        $stmt = $pdo->prepare(PROJECT_SELECT . ' WHERE p.id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            reply(404, ['ok' => false, 'error' => 'That project no longer exists.']);
        }
        reply(200, ['ok' => true, 'project' => project_row($row)]);
    }

    /* ------------------------------------------------------------ close */

    if ($action === 'close') {
        $stmt = $pdo->prepare('UPDATE projects SET status = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?');
        $stmt->execute([!empty($in['closed']) ? 'closed' : 'active', $staff['username'], (int) ($in['id'] ?? 0)]);
        reply(200, ['ok' => true]);
    }

    /* ---------------------------------------------------- reject, restore */

    if ($action === 'reject') {
        $id = (int) ($in['id'] ?? 0);
        $reason = text_field($in, 'reason', 300);
        if ($reason === '') {
            reply(422, ['ok' => false, 'error' => 'Say why, so the reason is on record.']);
        }
        $pdo->beginTransaction();
        $stmt = $pdo->prepare(
            'UPDATE projects SET status = \'rejected\', reject_reason = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?'
        );
        $stmt->execute([$reason, $staff['username'], $id]);
        // Surveys still to come are off; past ones stay as a record.
        $del = $pdo->prepare('DELETE FROM events WHERE project_id = ? AND kind = \'survey\' AND start_at > UTC_TIMESTAMP()');
        $del->execute([$id]);
        $pdo->commit();
        reply(200, ['ok' => true, 'unscheduled' => $del->rowCount()]);
    }

    if ($action === 'restore') {
        $pdo->prepare(
            'UPDATE projects SET status = \'active\', reject_reason = NULL, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?'
        )->execute([$staff['username'], (int) ($in['id'] ?? 0)]);
        reply(200, ['ok' => true]);
    }

    /* ----------------------------------------------------------- permit */

    if ($action === 'permit') {
        $projectId = (int) ($in['projectId'] ?? 0);
        $step = (string) ($in['step'] ?? '');
        if (!in_array($step, PERMIT_STEPS, true)) {
            reply(422, ['ok' => false, 'error' => 'Unknown permit step.']);
        }
        $exists = $pdo->prepare('SELECT 1 FROM projects WHERE id = ?');
        $exists->execute([$projectId]);
        if (!$exists->fetch()) {
            reply(404, ['ok' => false, 'error' => 'That project no longer exists.']);
        }
        $doneOn = ($in['doneOn'] ?? null) === null ? null : iso_date($in['doneOn']);
        if (($in['doneOn'] ?? null) !== null && $doneOn === null) {
            reply(422, ['ok' => false, 'error' => 'The date must be YYYY-MM-DD.']);
        }
        $owner = strtolower(text_field($in, 'owner', 64));
        $people = array_column(staff_directory(), null, 'username');
        if ($owner !== '' && !isset($people[$owner])) {
            reply(422, ['ok' => false, 'error' => 'That person is not on the staff list.']);
        }

        $pdo->beginTransaction();
        if ($doneOn === null) {
            $pdo->prepare('DELETE FROM permits WHERE project_id = ? AND step = ?')->execute([$projectId, $step]);
        } else {
            $pdo->prepare(
                'INSERT INTO permits (project_id, step, done_on, owner_username, notes, updated_by, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE done_on = VALUES(done_on), owner_username = VALUES(owner_username),
                    notes = VALUES(notes), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)'
            )->execute([$projectId, $step, $doneOn, $owner, text_field($in, 'notes', 2000), $staff['username']]);
        }

        // Submitted and approved are dates worth seeing on the calendar; keep one marker each.
        if ($step !== 'docs_prepared') {
            $kind = 'permit_' . $step;
            $pdo->prepare('DELETE FROM events WHERE project_id = ? AND kind = ?')->execute([$projectId, $kind]);
            if ($doneOn !== null) {
                $pdo->prepare(
                    'INSERT INTO events (batch, project_id, job_id, kind, start_at, end_at, all_day, created_by, created_at, updated_at)
                     VALUES (?, ?, NULL, ?, ?, ?, 1, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
                )->execute([
                    bin2hex(random_bytes(16)), $projectId, $kind,
                    manila_day_utc($doneOn), manila_day_utc($doneOn, 1), $staff['username'],
                ]);
                if ($owner !== '') {
                    $pdo->prepare('INSERT INTO event_staff (event_id, username, role) VALUES (?, ?, ?)')
                        ->execute([(int) $pdo->lastInsertId(), $owner, $people[$owner]['role']]);
                }
            }
        }
        $pdo->commit();
        reply(200, ['ok' => true]);
    }

    reply(400, ['ok' => false, 'error' => 'Unknown action.']);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('projects.php: ' . $e->getMessage());
    reply(500, ['ok' => false, 'error' => 'The project database is not reachable. Check the DB_* environment variables in hPanel.']);
}
