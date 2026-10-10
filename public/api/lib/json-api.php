<?php
declare(strict_types=1);

/**
 * Brylliant Solar — request and reply helpers for the staff JSON APIs
 * (projects.php, jobs.php, schedule.php). Not an endpoint: lib/.htaccess
 * denies direct requests.
 *
 * Same-origin only, like auth.php: no CORS headers, JSON POSTs, SameSite cookie.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

function reply(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

/** The decoded JSON body of a POST, or a 4xx reply. */
function read_json_post(int $maxBytes): array {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        reply(405, ['ok' => false, 'error' => 'Method not allowed.']);
    }
    if (!str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) {
        reply(415, ['ok' => false, 'error' => 'Expected JSON.']);
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '' || strlen($raw) > $maxBytes) {
        reply(413, ['ok' => false, 'error' => 'The request is empty or too large.']);
    }
    $in = json_decode($raw, true);
    if (!is_array($in)) {
        reply(400, ['ok' => false, 'error' => 'Could not read the request.']);
    }
    return $in;
}

/** Trimmed text with control characters removed, cut to $max characters. */
function text_field(array $in, string $key, int $max): string {
    $v = trim((string) ($in[$key] ?? ''));
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '';
    return mb_substr($v, 0, $max);
}

/** A stored UTC DATETIME as ISO with Z, so the app can show it in Manila time. */
function utc_iso(?string $dt): ?string {
    return $dt === null ? null : str_replace(' ', 'T', $dt) . 'Z';
}

/** An ISO timestamp from the app as a UTC DATETIME string, or null if it doesn't parse. */
function to_utc_datetime(mixed $iso): ?string {
    if (!is_string($iso) || strlen($iso) > 40) {
        return null;
    }
    try {
        $d = new DateTimeImmutable($iso);
    } catch (Exception) {
        return null;
    }
    return $d->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

/** A YYYY-MM-DD string if it is a real date, else null. */
function iso_date(mixed $s): ?string {
    if (!is_string($s)) {
        return null;
    }
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $s, new DateTimeZone('UTC'));
    return $d && $d->format('Y-m-d') === $s ? $s : null;
}
