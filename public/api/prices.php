<?php
declare(strict_types=1);

/**
 * Brylliant Solar — the price list. Owner only.
 *
 *   GET  /api/prices.php  -> { ok, prices: { key: php }, updated: { key: { by, at } } }
 *   POST {action: "save", prices: { key: php | null }}  -> { ok, prices, updated }
 *        null removes a price, so the item goes back to its default.
 *
 * Only prices set on the Prices page are stored; the items, their units and
 * default prices are in src/lib/price-list.ts.
 */

require_once __DIR__ . '/lib/json-api.php';
require_once __DIR__ . '/lib/staff-session.php';
require_once __DIR__ . '/lib/db.php';

const MAX_PRICE_ITEMS = 500;

function price_list(PDO $pdo): array {
    $prices = [];
    $updated = [];
    foreach ($pdo->query('SELECT * FROM prices ORDER BY item_key')->fetchAll() as $r) {
        $prices[$r['item_key']] = (float) $r['php'];
        $updated[$r['item_key']] = ['by' => $r['updated_by'], 'at' => utc_iso($r['updated_at'])];
    }
    return ['prices' => (object) $prices, 'updated' => (object) $updated];
}

$staff = require_owner();

try {
    $pdo = db();

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        reply(200, ['ok' => true] + price_list($pdo));
    }

    $in = read_json_post(256 * 1024);
    if (($in['action'] ?? '') !== 'save' || !is_array($in['prices'] ?? null)) {
        reply(400, ['ok' => false, 'error' => 'Unknown action.']);
    }
    if (count($in['prices']) > MAX_PRICE_ITEMS) {
        reply(422, ['ok' => false, 'error' => 'Too many prices in one save.']);
    }

    $set = $pdo->prepare(
        'INSERT INTO prices (item_key, php, updated_by, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE php = VALUES(php), updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()'
    );
    $clear = $pdo->prepare('DELETE FROM prices WHERE item_key = ?');
    $pdo->beginTransaction();
    foreach ($in['prices'] as $key => $php) {
        $key = (string) $key;
        if ($key === '' || strlen($key) > 80 || !preg_match('/^[A-Za-z0-9 ._\-]+$/', $key)) {
            $pdo->rollBack();
            reply(422, ['ok' => false, 'error' => "Not a price item: $key"]);
        }
        if ($php === null) {
            $clear->execute([$key]);
        } elseif (is_numeric($php) && (float) $php >= 0 && (float) $php < 1e9) {
            $set->execute([$key, round((float) $php, 2), $staff['username']]);
        } else {
            $pdo->rollBack();
            reply(422, ['ok' => false, 'error' => "Price for $key must be a number of pesos."]);
        }
    }
    $pdo->commit();
    reply(200, ['ok' => true] + price_list($pdo));
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('prices.php: ' . $e->getMessage());
    reply(500, ['ok' => false, 'error' => 'The price list database is not reachable. Check the DB_* environment variables in hPanel.']);
}
