<?php
declare(strict_types=1);

/**
 * Brylliant Solar — survey request endpoint.
 *
 * Lives in public/api/ so that `expo export` copies it verbatim into dist/ and the
 * Hostinger build deploys it to https://brylliant.solar/api/quote.php.
 *
 * Mail credentials are NOT in this file and are not in git. They are hPanel
 * environment variables, written to api/lib/env.php at build time by
 * scripts/write-server-env.js — see load_config() below.
 */

const MAX_PER_HOUR = 6;
const MAX_DAYS_AHEAD = 30;
/** Must match TIMES in src/app/(site)/book.tsx. */
const TIMES = ['Morning', 'Afternoon', 'Any time'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/* ------------------------------------------------------------------ config */

require_once __DIR__ . '/lib/server-env.php';

/**
 * SMTP settings come from hPanel environment variables (MAIL_USER, MAIL_PASSWORD,
 * MAIL_TO, MAIL_HOST, MAIL_PORT), like every other server secret. The older
 * private/mail-config.php above the document root still works as a fallback.
 */
function load_config(): array {
    $user = server_env('MAIL_USER');
    $pass = server_env('MAIL_PASSWORD');
    if ($user !== '' && $pass !== '') {
        return [
            'host' => server_env('MAIL_HOST') ?: 'smtp.hostinger.com',
            'port' => (int) (server_env('MAIL_PORT') ?: 465),
            'user' => $user,
            'pass' => $pass,
            'to'   => server_env('MAIL_TO') ?: $user,
        ];
    }

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
    throw new RuntimeException('MAIL_USER / MAIL_PASSWORD are not set and no private/mail-config.php was found');
}

/* -------------------------------------------------------------------- http */

function fail(int $status, string $message): void {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = ['https://brylliant.solar', 'https://www.brylliant.solar', 'http://localhost:8081', 'http://localhost:19006'];
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
$time    = field($in, 'time', 40);
$email   = field($in, 'email', 200);

if ($name === '' || $phone === '' || $address === '') {
    fail(422, 'Name, mobile number and address are all required.');
}
if (strlen((string) preg_replace('/\D/', '', $phone)) < 10) {
    fail(422, 'That mobile number looks too short.');
}
if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    fail(422, 'That email address does not look right.');
}
if (!in_array($time, TIMES, true)) {
    $time = 'Any time';
}

/**
 * Days the customer is free, as YYYY-MM-DD. Only real dates from today to
 * MAX_DAYS_AHEAD (Manila time) are kept, so nothing free-form reaches an email.
 */
$dates = [];
$today = new DateTimeImmutable('today', new DateTimeZone('Asia/Manila'));
$latest = $today->modify('+' . MAX_DAYS_AHEAD . ' days');
foreach (array_slice(is_array($in['dates'] ?? null) ? $in['dates'] : [], 0, 14) as $d) {
    $day = is_string($d) ? DateTimeImmutable::createFromFormat('!Y-m-d', $d, new DateTimeZone('Asia/Manila')) : false;
    if ($day && $day->format('Y-m-d') === $d && $day >= $today && $day <= $latest) {
        $dates[$d] = $day->format('D j M Y');
    }
}
ksort($dates);
if (!$dates) {
    fail(422, 'Please pick at least one day you are free for the visit.');
}
$datesText = implode(', ', $dates);

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

/* ------------------------------------------------------------ store request */

/**
 * Saved first, so the request reaches the staff calendar even if the email
 * fails; and if the database is down, the email still goes out as before.
 */
$stored = false;
try {
    require_once __DIR__ . '/lib/db.php';
    $billNum = (float) preg_replace('/[^\d.]/', '', $bill);
    $stmt = db()->prepare(
        'INSERT INTO projects (customer, phone, email, address, monthly_bill, property, free_dates_json, time_pref,
            source, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'booking\', \'website\', \'website\', UTC_TIMESTAMP(), UTC_TIMESTAMP())'
    );
    $stmt->execute([
        $name, $phone, $email, $address, $billNum > 0 ? $billNum : null, $type,
        json_encode(array_keys($dates)), $time,
    ]);
    $stored = true;
} catch (Throwable $e) {
    error_log('[quote.php] store: ' . $e->getMessage());
}

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

/**
 * Sends one plain-text message from the configured mailbox. $to and $replyTo
 * must already be validated addresses: they go straight into SMTP and headers.
 */
function smtp_send(array $cfg, string $to, string $fromName, string $subject, string $body, string $replyTo = ''): void {
    $host = (string) ($cfg['host'] ?? 'smtp.hostinger.com');
    $port = (int) ($cfg['port'] ?? 465);
    $user = (string) $cfg['user'];
    $pass = (string) $cfg['pass'];

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
        smtp_cmd($fp, 'EHLO ' . ($_SERVER['HTTP_HOST'] ?? 'brylliant.solar'), 250);
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
            'From: ' . $fromName . ' <' . $user . '>',
            'To: <' . $to . '>',
            'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
            'Date: ' . date(DATE_RFC2822),
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@brylliant.solar>',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
        ];
        if ($replyTo !== '') {
            $headers[] = 'Reply-To: <' . $replyTo . '>';
        }

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
    'Email:     ' . ($email !== '' ? $email : 'not given'),
    'Property:  ' . ($type !== '' ? $type : 'not given'),
    'Address:   ' . $address,
    'Bill:      ' . ($bill !== '' ? '₱' . $bill . ' / month' : 'not given'),
    'Free on:   ' . $datesText,
    'Time:      ' . $time,
    '',
    '--',
    'Sent from the booking form at brylliant.solar',
    'Received ' . date('D, d M Y H:i') . ' server time, from ' . $ip,
]);

$cfg = null;
try {
    $cfg = load_config();
    smtp_send($cfg, (string) ($cfg['to'] ?? $cfg['user']), 'Brylliant Solar website', $subject, $body, $email);
} catch (Throwable $e) {
    error_log('[quote.php] ' . $e->getMessage());
    // Already on the staff calendar, so the customer doesn't need to send it again.
    if (!$stored) {
        fail(502, 'We could not send that just now. Please message or call us instead.');
    }
}

/*
 * Confirmation to the customer. Anyone can type any address into the form, so
 * this carries only our own wording plus the validated dates, time and digits
 * of the phone number — never the name or address — and cannot be used to send
 * someone else arbitrary text. The request is already in our inbox, so a
 * failure here is logged and reported, not fatal.
 */
$confirmed = false;
if ($email !== '' && $cfg !== null) {
    $digits = (string) preg_replace('/[^\d+ ]/', '', $phone);
    $confirmation = implode("\n", [
        'Hi,',
        '',
        'Thank you for booking a free site survey with Brylliant Solar. We have received your request.',
        '',
        'Days you are free:  ' . $datesText,
        'Time of day:        ' . $time,
        '',
        'We will call you on ' . $digits . ' within one working day to confirm the date and time.',
        '',
        'The survey is free, takes about an hour and comes with no obligation. We measure your roof,',
        'check the shading and your electrical panel, and within a week you get a written quotation —',
        'or an honest explanation of why your roof is not a good fit.',
        '',
        'Please have these ready for the visit if you can:',
        '- Your last 12 electricity bills',
        '- Any roof or building plans',
        '',
        'Need to change something? Just reply to this email.',
        '',
        'Gracias,',
        'Brylliant Solar',
        'Zamboanga City',
        '',
        '--',
        'You received this because this address was entered on the booking form at brylliant.solar.',
        'If that was not you, you can ignore this email.',
    ]);
    try {
        smtp_send($cfg, $email, 'Brylliant Solar', 'Your survey request — Brylliant Solar', $confirmation, (string) ($cfg['to'] ?? ''));
        $confirmed = true;
    } catch (Throwable $e) {
        error_log('[quote.php] confirmation: ' . $e->getMessage());
    }
}

echo json_encode(['ok' => true, 'confirmed' => $confirmed], JSON_UNESCAPED_UNICODE);
