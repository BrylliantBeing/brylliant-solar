<?php
declare(strict_types=1);

/**
 * Brylliant Solar — jobs: the bill of materials actually installed. Owner only.
 *
 *   GET  /api/jobs.php                -> { ok, jobs: [summary…] } newest first
 *   GET  /api/jobs.php?id=4           -> { ok, job: {summary…, items, settings} }
 *   POST {action: "save", id?, projectId?, quoteId?, systemType, items, settings} -> { ok, job: summary }
 *        Without a projectId the job joins its quote's project, or a new one named after the quote.
 *   POST {action: "delete", id}       -> { ok }  (and takes its installation off the calendar)
 */

require_once __DIR__ . '/lib/json-api.php';
require_once __DIR__ . '/lib/staff-session.php';
require_once __DIR__ . '/lib/db.php';

const MAX_ITEMS = 300;
const SYSTEM_TYPES = ['hybrid', 'grid-tie'];

function job_summary(array $r): array {
    return [
        'id'         => (int) $r['id'],
        'projectId'  => (int) $r['project_id'],
        'quoteId'    => $r['quote_id'] !== null ? (int) $r['quote_id'] : null,
        'customer'   => $r['customer'],
        'address'    => $r['address'],
        'systemType' => $r['system_type'],
        'panels'     => (int) $r['panels'],
        'total'      => (float) $r['total'],
        'status'     => $r['status'],
        'updatedBy'  => $r['updated_by'],
        'updatedAt'  => utc_iso($r['updated_at']),
        'installAt'  => utc_iso($r['install_at']),
    ];
}

const JOB_SELECT = 'SELECT j.*, p.customer, p.address,
    (SELECT MIN(e.start_at) FROM events e WHERE e.job_id = j.id AND e.kind = \'install\') AS install_at
    FROM jobs j JOIN projects p ON p.id = j.project_id';

/** Keeps only the fields a line item has, with the right types. Null if it isn't one. */
function clean_item(mixed $it): ?array {
    if (!is_array($it) || !is_string($it['id'] ?? null) || !is_string($it['name'] ?? null)) {
        return null;
    }
    $n = static fn (string $k): float => is_numeric($it[$k] ?? null) ? max(0.0, (float) $it[$k]) : 0.0;
    $s = static fn (string $k, int $max): string => mb_substr(trim((string) ($it[$k] ?? '')), 0, $max);
    $item = [
        'id'               => $s('id', 64),
        'category'         => $s('category', 64),
        'kind'             => $s('kind', 24),
        'name'             => $s('name', 200),
        'unit'             => $s('unit', 24),
        'qty'              => $n('qty'),
        'unitPrice'        => $n('unitPrice'),
        'defaultQty'       => is_numeric($it['defaultQty'] ?? null) ? (float) $it['defaultQty'] : null,
        'defaultUnitPrice' => is_numeric($it['defaultUnitPrice'] ?? null) ? (float) $it['defaultUnitPrice'] : null,
    ];
    if (in_array($it['basis'] ?? null, ['job', 'inverter', 'string', 'panel'], true) && is_numeric($it['perBasis'] ?? null)) {
        $item['basis'] = $it['basis'];
        $item['perBasis'] = (float) $it['perBasis'];
    }
    return $item;
}

$staff = require_owner();

try {
    $pdo = db();

    /* ------------------------------------------------------------- read */

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        if (isset($_GET['id'])) {
            $stmt = $pdo->prepare(JOB_SELECT . ' WHERE j.id = ?');
            $stmt->execute([(int) $_GET['id']]);
            $row = $stmt->fetch();
            if (!$row) {
                reply(404, ['ok' => false, 'error' => 'That job no longer exists.']);
            }
            reply(200, ['ok' => true, 'job' => job_summary($row) + [
                'items'    => json_decode($row['items_json'], true),
                'settings' => json_decode($row['settings_json'], true),
            ]]);
        }
        reply(200, ['ok' => true, 'jobs' => array_map('job_summary', $pdo->query(JOB_SELECT . ' ORDER BY j.updated_at DESC LIMIT 300')->fetchAll())]);
    }

    $in = read_json_post(1024 * 1024);
    $action = $in['action'] ?? '';

    /* ----------------------------------------------------------- delete */

    if ($action === 'delete') {
        $id = (int) ($in['id'] ?? 0);
        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM events WHERE job_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM jobs WHERE id = ?')->execute([$id]);
        $pdo->commit();
        reply(200, ['ok' => true]);
    }
    if ($action !== 'save') {
        reply(400, ['ok' => false, 'error' => 'Unknown action.']);
    }

    /* ------------------------------------------------------------- save */

    $systemType = (string) ($in['systemType'] ?? '');
    if (!in_array($systemType, SYSTEM_TYPES, true)) {
        reply(422, ['ok' => false, 'error' => 'Unknown system type.']);
    }
    $rawItems = $in['items'] ?? null;
    if (!is_array($rawItems) || count($rawItems) > MAX_ITEMS) {
        reply(422, ['ok' => false, 'error' => 'The job has no items, or more than ' . MAX_ITEMS . '.']);
    }
    $items = array_values(array_filter(array_map('clean_item', $rawItems)));
    $settings = is_array($in['settings'] ?? null) ? array_filter($in['settings'], 'is_numeric') : [];
    $panels = 0;
    $total = 0.0;
    foreach ($items as $it) {
        $total += $it['qty'] * $it['unitPrice'];
        if ($it['kind'] === 'panel') {
            $panels += (int) round($it['qty']);
        }
    }

    $quoteId = (int) ($in['quoteId'] ?? 0) ?: null;
    $projectId = (int) ($in['projectId'] ?? 0) ?: null;

    $pdo->beginTransaction();
    if ($projectId === null && $quoteId !== null) {
        $stmt = $pdo->prepare('SELECT customer, project_id FROM quotes WHERE id = ?');
        $stmt->execute([$quoteId]);
        $quote = $stmt->fetch();
        if (!$quote) {
            $pdo->rollBack();
            reply(404, ['ok' => false, 'error' => 'That quote no longer exists.']);
        }
        $projectId = $quote['project_id'] !== null ? (int) $quote['project_id'] : null;
        if ($projectId === null) {
            $pdo->prepare(
                'INSERT INTO projects (customer, free_dates_json, source, created_by, updated_by, created_at, updated_at)
                 VALUES (?, \'[]\', \'quote\', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
            )->execute([$quote['customer'], $staff['username'], $staff['username']]);
            $projectId = (int) $pdo->lastInsertId();
        }
    }
    if ($projectId === null) {
        $pdo->rollBack();
        reply(422, ['ok' => false, 'error' => 'Choose the project this job belongs to.']);
    }
    $exists = $pdo->prepare('SELECT 1 FROM projects WHERE id = ?');
    $exists->execute([$projectId]);
    if (!$exists->fetch()) {
        $pdo->rollBack();
        reply(404, ['ok' => false, 'error' => 'That project no longer exists.']);
    }
    if ($quoteId !== null) {
        $pdo->prepare('UPDATE quotes SET project_id = ? WHERE id = ?')->execute([$projectId, $quoteId]);
    }

    $values = [
        'project_id'    => $projectId,
        'quote_id'      => $quoteId,
        'system_type'   => $systemType,
        'items_json'    => json_encode($items, JSON_UNESCAPED_UNICODE),
        'settings_json' => json_encode($settings),
        'panels'        => $panels,
        'total'         => round($total, 2),
        'updated_by'    => $staff['username'],
    ];
    $id = (int) ($in['id'] ?? 0);
    if ($id > 0) {
        $stmt = $pdo->prepare(
            'UPDATE jobs SET project_id = :project_id, quote_id = :quote_id, system_type = :system_type,
                items_json = :items_json, settings_json = :settings_json, panels = :panels, total = :total,
                updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
             WHERE id = :id'
        );
        $stmt->execute($values + ['id' => $id]);
        // An installation already booked moves with the job's project.
        $pdo->prepare('UPDATE events SET project_id = ? WHERE job_id = ?')->execute([$projectId, $id]);
    } else {
        $stmt = $pdo->prepare(
            'INSERT INTO jobs (project_id, quote_id, system_type, items_json, settings_json, panels, total,
                created_by, updated_by, created_at, updated_at)
             VALUES (:project_id, :quote_id, :system_type, :items_json, :settings_json, :panels, :total,
                :created_by, :updated_by, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
        );
        $stmt->execute($values + ['created_by' => $staff['username']]);
        $id = (int) $pdo->lastInsertId();
    }
    $pdo->commit();

    $stmt = $pdo->prepare(JOB_SELECT . ' WHERE j.id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
        reply(404, ['ok' => false, 'error' => 'That job was deleted. Save it as a new job instead.']);
    }
    reply(200, ['ok' => true, 'job' => job_summary($row)]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('jobs.php: ' . $e->getMessage());
    reply(500, ['ok' => false, 'error' => 'The job database is not reachable. Check the DB_* environment variables in hPanel.']);
}
