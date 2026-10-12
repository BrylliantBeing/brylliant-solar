<?php
declare(strict_types=1);

/**
 * Brylliant Solar — PV designs, one per project. Owner only.
 *
 *   GET  /api/designs.php?project=4  -> { ok, design: {...} | null, project: {...} }
 *   POST {action: "save", projectId, jobId?, site, layout, inputs, result} -> { ok, updatedAt }
 *
 * The browser does all the maths (calculator/src/pvDesign.ts); this stores what it sends.
 */

require_once __DIR__ . '/lib/json-api.php';
require_once __DIR__ . '/lib/staff-session.php';
require_once __DIR__ . '/lib/db.php';

/** Satellite tiles at roof zoom are referenced, not stored, so 4 MB is ample. */
const MAX_DESIGN_BYTES = 4 * 1024 * 1024;

$staff = require_owner();

try {
    $pdo = db();

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        $projectId = (int) ($_GET['project'] ?? 0);
        $stmt = $pdo->prepare('SELECT id, customer, address, phone, email FROM projects WHERE id = ?');
        $stmt->execute([$projectId]);
        $project = $stmt->fetch();
        if (!$project) {
            reply(404, ['ok' => false, 'error' => 'That project no longer exists.']);
        }
        $stmt = $pdo->prepare('SELECT * FROM designs WHERE project_id = ?');
        $stmt->execute([$projectId]);
        $row = $stmt->fetch();
        reply(200, [
            'ok'      => true,
            'project' => [
                'id'       => (int) $project['id'],
                'customer' => $project['customer'],
                'address'  => $project['address'],
                'phone'    => $project['phone'],
                'email'    => $project['email'],
            ],
            'design'  => $row ? [
                'projectId' => (int) $row['project_id'],
                'jobId'     => $row['job_id'] !== null ? (int) $row['job_id'] : null,
                'site'      => json_decode($row['site_json'], true),
                'layout'    => json_decode($row['layout_json'], true),
                'inputs'    => json_decode($row['inputs_json'], true),
                'result'    => json_decode($row['result_json'], true),
                'updatedBy' => $row['updated_by'],
                'updatedAt' => utc_iso($row['updated_at']),
            ] : null,
        ]);
    }

    $in = read_json_post(MAX_DESIGN_BYTES);
    if (($in['action'] ?? '') !== 'save') {
        reply(400, ['ok' => false, 'error' => 'Unknown action.']);
    }
    $projectId = (int) ($in['projectId'] ?? 0);
    $exists = $pdo->prepare('SELECT 1 FROM projects WHERE id = ?');
    $exists->execute([$projectId]);
    if (!$exists->fetch()) {
        reply(404, ['ok' => false, 'error' => 'That project no longer exists.']);
    }
    foreach (['site', 'layout', 'inputs', 'result'] as $key) {
        if (!is_array($in[$key] ?? null)) {
            reply(422, ['ok' => false, 'error' => "The design is missing its $key."]);
        }
    }
    $json = static fn (array $v): string => json_encode($v, JSON_UNESCAPED_UNICODE);
    $jobId = (int) ($in['jobId'] ?? 0) ?: null;

    $stmt = $pdo->prepare(
        'INSERT INTO designs (project_id, job_id, site_json, layout_json, inputs_json, result_json,
            created_by, updated_by, created_at, updated_at)
         VALUES (:project_id, :job_id, :site, :layout, :inputs, :result, :by, :by2, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE job_id = VALUES(job_id), site_json = VALUES(site_json),
            layout_json = VALUES(layout_json), inputs_json = VALUES(inputs_json),
            result_json = VALUES(result_json), updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()'
    );
    $stmt->execute([
        'project_id' => $projectId,
        'job_id'     => $jobId,
        'site'       => $json($in['site']),
        'layout'     => $json($in['layout']),
        'inputs'     => $json($in['inputs']),
        'result'     => $json($in['result']),
        'by'         => $staff['username'],
        'by2'        => $staff['username'],
    ]);
    $stmt = $pdo->prepare('SELECT updated_at FROM designs WHERE project_id = ?');
    $stmt->execute([$projectId]);
    reply(200, ['ok' => true, 'updatedAt' => utc_iso($stmt->fetchColumn() ?: null)]);
} catch (Throwable $e) {
    error_log('designs.php: ' . $e->getMessage());
    reply(500, ['ok' => false, 'error' => 'The design database is not reachable. Check the DB_* environment variables in hPanel.']);
}
