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

    // One customer's pipeline: survey request → quote → job → permits → installation.
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS projects (
            id              INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
            customer        VARCHAR(200)  NOT NULL,
            phone           VARCHAR(40)   NOT NULL DEFAULT '',
            email           VARCHAR(200)  NOT NULL DEFAULT '',
            address         VARCHAR(300)  NOT NULL DEFAULT '',
            monthly_bill    DECIMAL(12,2) NULL,
            property        VARCHAR(40)   NOT NULL DEFAULT '',
            -- Days the customer said they are free, as ["YYYY-MM-DD", …]
            free_dates_json TEXT          NOT NULL,
            time_pref       VARCHAR(40)   NOT NULL DEFAULT '',
            -- booking (the website form), manual (typed in by staff) or quote (made from a saved quote)
            source          VARCHAR(16)   NOT NULL,
            notes           TEXT          NULL,
            -- active, closed or rejected
            status          VARCHAR(16)   NOT NULL DEFAULT 'active',
            created_by      VARCHAR(64)   NOT NULL,
            updated_by      VARCHAR(64)   NOT NULL,
            created_at      DATETIME      NOT NULL,
            updated_at      DATETIME      NOT NULL,
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        SQL);

    $hasReject = $pdo->query(
        "SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'reject_reason'"
    )->fetch();
    if (!$hasReject) {
        // Why a survey request was turned down (status = rejected)
        $pdo->exec('ALTER TABLE projects ADD COLUMN reject_reason VARCHAR(300) NULL AFTER status');
    }

    $hasProject = $pdo->query(
        "SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'project_id'"
    )->fetch();
    if (!$hasProject) {
        $pdo->exec('ALTER TABLE quotes ADD COLUMN project_id INT UNSIGNED NULL AFTER id, ADD KEY idx_project (project_id)');
    }

    // The bill of materials actually installed, seeded from a quote and edited by hand.
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS jobs (
            id            INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
            project_id    INT UNSIGNED  NOT NULL,
            quote_id      INT UNSIGNED  NULL,
            system_type   VARCHAR(16)   NOT NULL,
            -- Line items (src/lib/job-items.ts JobItem[]) and the specs the warnings check against
            items_json    LONGTEXT      NOT NULL,
            settings_json TEXT          NOT NULL,
            -- Copied out of items_json for lists and for sizing the installation
            panels        INT UNSIGNED  NOT NULL,
            total         DECIMAL(12,2) NOT NULL,
            status        VARCHAR(16)   NOT NULL DEFAULT 'open',
            created_by    VARCHAR(64)   NOT NULL,
            updated_by    VARCHAR(64)   NOT NULL,
            created_at    DATETIME      NOT NULL,
            updated_at    DATETIME      NOT NULL,
            KEY idx_project (project_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        SQL);

    // Calendar entries. Events booked together (an installation's days) share a batch.
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS events (
            id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            batch       CHAR(32)     NOT NULL,
            project_id  INT UNSIGNED NOT NULL,
            job_id      INT UNSIGNED NULL,
            -- survey, install, inspection, permit_submitted or permit_approved
            kind        VARCHAR(24)  NOT NULL,
            start_at    DATETIME     NOT NULL,
            end_at      DATETIME     NOT NULL,
            all_day     TINYINT(1)   NOT NULL DEFAULT 0,
            notes       TEXT         NULL,
            created_by  VARCHAR(64)  NOT NULL,
            created_at  DATETIME     NOT NULL,
            updated_at  DATETIME     NOT NULL,
            KEY idx_start (start_at),
            KEY idx_project (project_id),
            KEY idx_batch (batch)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS event_staff (
            event_id  INT UNSIGNED NOT NULL,
            username  VARCHAR(64)  NOT NULL,
            -- The role they fill on this event, which may differ from their account's
            role      VARCHAR(24)  NOT NULL,
            PRIMARY KEY (event_id, username),
            KEY idx_username (username),
            CONSTRAINT fk_event_staff_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        SQL);

    // Accounts made on the owner dashboard. STAFF_USERS accounts are not stored here.
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS staff (
            username   VARCHAR(64)  NOT NULL PRIMARY KEY,
            name       VARCHAR(100) NOT NULL,
            -- owner, lead_installer, installer or electrician
            role       VARCHAR(24)  NOT NULL,
            -- pbkdf2-sha256.<iterations>.<salt>.<hash>, as made by hash_staff_password()
            hash       VARCHAR(255) NOT NULL,
            created_by VARCHAR(64)  NOT NULL,
            updated_by VARCHAR(64)  NOT NULL,
            created_at DATETIME     NOT NULL,
            updated_at DATETIME     NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS permits (
            project_id     INT UNSIGNED NOT NULL,
            -- docs_prepared, submitted or approved
            step           VARCHAR(16)  NOT NULL,
            done_on        DATE         NOT NULL,
            owner_username VARCHAR(64)  NOT NULL DEFAULT '',
            notes          TEXT         NULL,
            updated_by     VARCHAR(64)  NOT NULL,
            updated_at     DATETIME     NOT NULL,
            PRIMARY KEY (project_id, step)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        SQL);
}
