<?php
declare(strict_types=1);

/**
 * Brylliant Solar — MySQL connection for the staff APIs.
 *
 * Credentials are hPanel environment variables (DB_HOST, DB_NAME, DB_USER,
 * DB_PASSWORD), read through server_env(). Never put them in git.
 * All times are stored in UTC; the app shows them in Asia/Manila.
 */

require_once __DIR__ . '/server-env.php';

/** @return array{host: string, name: string, user: string, pass: string} */
function db_config(): array {
    $cfg = [
        'host' => server_env('DB_HOST') ?: 'localhost',
        'name' => server_env('DB_NAME'),
        'user' => server_env('DB_USER'),
        'pass' => server_env('DB_PASSWORD'),
    ];
    if ($cfg['name'] === '' || $cfg['user'] === '' || $cfg['pass'] === '') {
        throw new RuntimeException('DB_NAME, DB_USER or DB_PASSWORD is not set in the hosting environment');
    }
    return $cfg;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $cfg = db_config();
    $pdo = new PDO(
        sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $cfg['host'], $cfg['name']),
        $cfg['user'],
        $cfg['pass'],
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
    $pdo->exec("SET time_zone = '+00:00'");
    ensure_schema($pdo);
    return $pdo;
}

/**
 * Creates the tables on first use, so a deploy needs no manual SQL.
 * Add new tables here with CREATE TABLE IF NOT EXISTS; change existing ones
 * with a guarded ALTER, never by editing the CREATE (it won't re-run).
 */
function ensure_schema(PDO $pdo): void {
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS quotes (
            id            INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
            customer      VARCHAR(200)  NOT NULL,
            total_price   DECIMAL(12,2) NOT NULL,
            system_kwp    DECIMAL(8,2)  NOT NULL,
            battery_kwh   DECIMAL(8,2)  NOT NULL,
            reduction_pct DECIMAL(5,2)  NOT NULL,
            -- Everything needed to reopen and recalculate: CSVs, assumptions, options
            inputs_json   LONGTEXT      NOT NULL,
            -- The calculator's QuoteResult exactly as it was shown when saved
            result_json   LONGTEXT      NOT NULL,
            created_by    VARCHAR(64)   NOT NULL,
            updated_by    VARCHAR(64)   NOT NULL,
            created_at    DATETIME      NOT NULL,
            updated_at    DATETIME      NOT NULL,
            KEY idx_updated (updated_at),
            KEY idx_customer (customer)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        SQL);
}
