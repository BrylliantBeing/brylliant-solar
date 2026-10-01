<?php
declare(strict_types=1);

/**
 * Brylliant Solar — saved quotes, staff only.
 *
 *   GET  /api/quotes.php[?q=search]          -> { ok, quotes: [summary…] } newest first
 *   GET  /api/quotes.php?id=12               -> { ok, quote: {summary…, inputs, result} }
 *   POST {action: "save", id?, customer, inputs, result}  -> { ok, quote: summary }
 *        (with id: overwrite that quote; without: create a new one)
 *   POST {action: "delete", id}             -> { ok }
 *
 * Same-origin only, like auth.php: no CORS headers, JSON POSTs, SameSite cookie.
 */

require_once __DIR__ . '/lib/staff-session.php';
require_once __DIR__ . '/lib/db.php';

/** A year of hourly CSV is ~250 KB; this leaves room for long outage logs. */
const MAX_BODY = 8 * 1024 * 1024;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

function reply(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

/** The columns a list shows, renamed to the app's camelCase. */
function summary(array $row): array {
    return [
        'id'           => (int) $row['id'],
        'customer'     => $row['customer'],
        'totalPrice'   => (float) $row['total_price'],
        'systemKwp'    => (float) $row['system_kwp'],
        'batteryKwh'   => (float) $row['battery_kwh'],
        'reductionPct' => (float) $row['reduction_pct'],
        'createdBy'    => $row['created_by'],
        'updatedBy'    => $row['updated_by'],
        // Stored in UTC; the trailing Z lets the app convert to Manila time.
        'createdAt'    => str_replace(' ', 'T', $row['created_at']) . 'Z',
        'updatedAt'    => str_replace(' ', 'T', $row['updated_at']) . 'Z',
    ];
}

const SUMMARY_COLUMNS = 'id, customer, total_price, system_kwp, battery_kwh, reduction_pct,
    created_by, updated_by, created_at, updated_at';

$staff = require_staff();

try {
    $pdo = db();
    $method = $_SERVER['REQUEST_METHOD'] ?? '';

    /* ------------------------------------------------------------- read */

    if ($method === 'GET') {
        if (isset($_GET['id'])) {
            $stmt = $pdo->prepare('SELECT ' . SUMMARY_COLUMNS . ', inputs_json, result_json FROM quotes WHERE id = ?');
            $stmt->execute([(int) $_GET['id']]);
            $row = $stmt->fetch();
            if (!$row) {
                reply(404, ['ok' => false, 'error' => 'That quote no longer exists.']);
            }
            reply(200, ['ok' => true, 'quote' => summary($row) + [
                'inputs' => json_decode($row['inputs_json'], true),
                'result' => json_decode($row['result_json'], true),
            ]]);
        }

        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $stmt = $pdo->prepare('SELECT ' . SUMMARY_COLUMNS . ' FROM quotes WHERE customer LIKE ? ORDER BY updated_at DESC LIMIT 200');
            $stmt->execute(['%' . addcslashes($q, '%_\\') . '%']);
        } else {
            $stmt = $pdo->query('SELECT ' . SUMMARY_COLUMNS . ' FROM quotes ORDER BY updated_at DESC LIMIT 200');
        }
        reply(200, ['ok' => true, 'quotes' => array_map('summary', $stmt->fetchAll())]);
    }

    if ($method !== 'POST') {
        reply(405, ['ok' => false, 'error' => 'Method not allowed.']);
    }
    if (!str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) {
        reply(415, ['ok' => false, 'error' => 'Expected JSON.']);
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '' || strlen($raw) > MAX_BODY) {
        reply(413, ['ok' => false, 'error' => 'The quote is empty or too large to save (8 MB limit).']);
    }
    $in = json_decode($raw, true);
    if (!is_array($in)) {
        reply(400, ['ok' => false, 'error' => 'Could not read the request.']);
    }

    /* ----------------------------------------------------------- delete */

    if (($in['action'] ?? '') === 'delete') {
        $stmt = $pdo->prepare('DELETE FROM quotes WHERE id = ?');
        $stmt->execute([(int) ($in['id'] ?? 0)]);
        reply(200, ['ok' => true]);
    }
    if (($in['action'] ?? '') !== 'save') {
        reply(400, ['ok' => false, 'error' => 'Unknown action.']);
    }

    /* ------------------------------------------------------------- save */

    $customer = trim((string) ($in['customer'] ?? ''));
    $inputs = $in['inputs'] ?? null;
    $result = $in['result'] ?? null;
    if ($customer === '' || mb_strlen($customer) > 200) {
        reply(422, ['ok' => false, 'error' => 'Give the quote a customer name (up to 200 characters).']);
    }
    if (!is_array($inputs) || !is_array($result) || !isset($result['pricing']['total'], $result['panels']['systemKw'])) {
        reply(422, ['ok' => false, 'error' => 'The quote data is incomplete.']);
    }

    $values = [
        'customer'      => $customer,
        'total_price'   => (float) $result['pricing']['total'],
        'system_kwp'    => (float) $result['panels']['systemKw'],
        'battery_kwh'   => (float) ($result['battery']['installedKwh'] ?? 0),
        'reduction_pct' => (float) ($result['bill']['reductionPercent'] ?? 0),
        'inputs_json'   => json_encode($inputs, JSON_UNESCAPED_UNICODE),
        'result_json'   => json_encode($result, JSON_UNESCAPED_UNICODE),
        'updated_by'    => $staff['username'],
    ];

    $id = (int) ($in['id'] ?? 0);
    if ($id > 0) {
        $stmt = $pdo->prepare(
            'UPDATE quotes SET customer = :customer, total_price = :total_price, system_kwp = :system_kwp,
                battery_kwh = :battery_kwh, reduction_pct = :reduction_pct, inputs_json = :inputs_json,
                result_json = :result_json, updated_by = :updated_by, updated_at = UTC_TIMESTAMP()
             WHERE id = :id'
        );
        $stmt->execute($values + ['id' => $id]);
        if ($stmt->rowCount() === 0 && !$pdo->query('SELECT 1 FROM quotes WHERE id = ' . $id)->fetch()) {
            reply(404, ['ok' => false, 'error' => 'That quote was deleted. Save it as a new quote instead.']);
        }
    } else {
        $stmt = $pdo->prepare(
            'INSERT INTO quotes (customer, total_price, system_kwp, battery_kwh, reduction_pct, inputs_json,
                result_json, created_by, updated_by, created_at, updated_at)
             VALUES (:customer, :total_price, :system_kwp, :battery_kwh, :reduction_pct, :inputs_json,
                :result_json, :updated_by, :updated_by2, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
        );
        $stmt->execute($values + ['updated_by2' => $staff['username']]);
        $id = (int) $pdo->lastInsertId();
    }

    $stmt = $pdo->prepare('SELECT ' . SUMMARY_COLUMNS . ' FROM quotes WHERE id = ?');
    $stmt->execute([$id]);
    reply(200, ['ok' => true, 'quote' => summary($stmt->fetch())]);
} catch (Throwable $e) {
    error_log('quotes.php: ' . $e->getMessage());
    reply(500, ['ok' => false, 'error' => 'The quote database is not reachable. Check the DB_* environment variables in hPanel.']);
}
