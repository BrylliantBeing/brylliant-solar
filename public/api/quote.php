<?php
declare(strict_types=1);

/**
 * Brylliant Solar — survey request endpoint.
 *
 * Lives in public/api/ so that `expo export` copies it verbatim into dist/ and the
 * Hostinger build deploys it to https://solar.brylletan.com/api/quote.php.
 *
 * Mail credentials are NOT in this file and are not in git. They are read from
 * ../private/mail-config.php, one level above the document root, so a redeploy
 * (which replaces the document root) cannot clobber them and the public repo
 * cannot leak them.
 */

const MAX_PER_HOUR = 6;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/* ------------------------------------------------------------------ config */

function load_config(): array {
    $docroot = $_SERVER['DOCUMENT_ROOT'] ?? '';
    $candidates = [];
    if ($docroot !== '') {
        $candidates[] = dirname($docroot) . '/private/mail-config.php';
    }
    $candidates[] = __DIR__ . '/../../private/mail-config.php';

    foreach ($candidates as $path) {
        if (is_readable($path)) {
            $cfg = require $path;
            if (is_array($cfg) && isset($cfg['user'], $cfg['pass'])) {
                return $cfg;
            }
        }
    }
    throw new RuntimeException('mail-config.php not found, unreadable, or incomplete');
}

/* -------------------------------------------------------------------- http */

function fail(int $status, string $message): void {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = ['https://solar.brylletan.com', 'http://localhost:8081', 'http://localhost:19006'];
if ($origin !== '' && in_array($origin, $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
}

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($method !== 'POST') {
    fail(405, 'Method not allowed.');
}

/* ------------------------------------------------------------------- input */

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '' || strlen($raw) > 8000) {
    fail(400, 'Request was empty or too large.');
}
$in = json_decode($raw, true);
if (!is_array($in)) {
    fail(400, 'Could not read the form.');
}

/** Bots fill in every field they can find; a real customer never sees this one. */
if (trim((string) ($in['company'] ?? '')) !== '') {
    echo json_encode(['ok' => true]);
    exit;
}

function field(array $in, string $key, int $max = 200): string {
    $v = trim((string) ($in[$key] ?? ''));
    // Strip control characters so nothing can forge a header line.
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '';
    return mb_substr($v, 0, $max);
}

$name    = field($in, 'name');
$phone   = field($in, 'phone', 40);
$address = field($in, 'address', 300);
$bill    = field($in, 'bill', 40);
$type    = field($in, 'property', 40);
$when    = field($in, 'when', 40);

if ($name === '' || $phone === '' || $address === '') {
    fail(422, 'Name, mobile number and address are all required.');
}
if (strlen((string) preg_replace('/\D/', '', $phone)) < 10) {
    fail(422, 'That mobile number looks too short.');
}

/* -------------------------------------------------------------- rate limit */

$ip    = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
$stamp = sys_get_temp_dir() . '/bs-quote-' . hash('sha256', $ip) . '.txt';
$hits  = [];
if (is_readable($stamp)) {
    $hits = array_filter(
        array_map('intval', explode(',', (string) file_get_contents($stamp))),
        static fn (int $t): bool => $t > time() - 3600
    );
}
if (count($hits) >= MAX_PER_HOUR) {
    fail(429, 'Too many requests from this connection. Please call us instead.');
}
$hits[] = time();
@file_put_contents($stamp, implode(',', $hits), LOCK_EX);

/* --------------------------------------------------------------- send mail */

/** Reads one SMTP reply, following multi-line continuations ("250-" vs "250 "). */
function smtp_read($fp): string {
    $out = '';
    while (($line = fgets($fp, 8192)) !== false) {
        $out .= $line;
        if (strlen($line) < 4 || $line[3] === ' ') {
            break;
        }
    }
    return $out;
}

function smtp_cmd($fp, string $line, int $expect): void {
    fwrite($fp, $line . "\r\n");
    $reply = smtp_read($fp);
    if ((int) substr($reply, 0, 3) !== $expect) {
        // Log the verb, never the argument — one of these carries the password.
        throw new RuntimeException(
            'SMTP ' . strtok($line, ' ') . ' expected ' . $expect . ', got ' . trim(substr($reply, 0, 120))
        );
    }
}

function smtp_send(array $cfg, string $subject, string $body): void {
    $host = (string) ($cfg['host'] ?? 'smtp.hostinger.com');
    $port = (int) ($cfg['port'] ?? 465);
    $user = (string) $cfg['user'];
    $pass = (string) $cfg['pass'];
    $to   = (string) ($cfg['to'] ?? $user);

    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $fp  = @stream_socket_client(
        "ssl://$host:$port",
        $errno,
        $errstr,
        20,
        STREAM_CLIENT_CONNECT,
        $ctx
    );
    if (!$fp) {
        throw new RuntimeException("connect $host:$port failed: $errstr ($errno)");
    }
    stream_set_timeout($fp, 20);

    try {
        if ((int) substr(smtp_read($fp), 0, 3) !== 220) {
            throw new RuntimeException('SMTP greeting refused');
        }
        smtp_cmd($fp, 'EHLO ' . ($_SERVER['HTTP_HOST'] ?? 'solar.brylletan.com'), 250);
        smtp_cmd($fp, 'AUTH LOGIN', 334);
        smtp_cmd($fp, base64_encode($user), 334);
        smtp_cmd($fp, base64_encode($pass), 235);
        smtp_cmd($fp, "MAIL FROM:<$user>", 250);
        smtp_cmd($fp, "RCPT TO:<$to>", 250);
        smtp_cmd($fp, 'DATA', 354);

        // RFC 5321: a lone "." ends DATA, so any body line starting with "." is doubled.
        $data = '';
        foreach (preg_split('/\r\n|\r|\n/', $body) ?: [] as $line) {
            $data .= (str_starts_with($line, '.') ? '.' . $line : $line) . "\r\n";
        }

        $headers = [
            'From: Brylliant Solar website <' . $user . '>',
            'To: <' . $to . '>',
            'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
            'Date: ' . date(DATE_RFC2822),
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@solar.brylletan.com>',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
        ];

        fwrite($fp, implode("\r\n", $headers) . "\r\n\r\n" . $data . ".\r\n");
        if ((int) substr(smtp_read($fp), 0, 3) !== 250) {
            throw new RuntimeException('SMTP refused the message body');
        }
        smtp_cmd($fp, 'QUIT', 221);
    } finally {
        fclose($fp);
    }
}

$subject = 'Survey request — ' . $name . ' (' . ($type !== '' ? $type : 'Home') . ')';
$body = implode("\n", [
    'SURVEY REQUEST — BRYLLIANT SOLAR',
    '',
    'Name:      ' . $name,
    'Mobile:    ' . $phone,
    'Property:  ' . ($type !== '' ? $type : 'not given'),
    'Address:   ' . $address,
    'Bill:      ' . ($bill !== '' ? '₱' . $bill . ' / month' : 'not given'),
    'Best time: ' . ($when !== '' ? $when : 'not given'),
    '',
    '--',
    'Sent from the booking form at solar.brylletan.com',
    'Received ' . date('D, d M Y H:i') . ' server time, from ' . $ip,
]);

try {
    smtp_send(load_config(), $subject, $body);
} catch (Throwable $e) {
    error_log('[quote.php] ' . $e->getMessage());
    fail(502, 'We could not send that just now. Please message or call us instead.');
}

echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
