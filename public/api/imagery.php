<?php
declare(strict_types=1);

/**
 * Brylliant Solar — satellite imagery for the PV design tool. Owner only.
 *
 *   GET /api/imagery.php
 *       -> { ok, google: { key, session, expiry } | null }
 *          null when GOOGLE_MAPS_KEY is not set; the design tool then falls back to Esri.
 *   GET /api/imagery.php?viewport=1&zoom=Z&north=..&south=..&east=..&west=..
 *       -> { ok, copyright, maxZoomRects }   Google's attribution text and the deepest zoom per area
 *
 * The key lives in the server environment, not the site's JavaScript. Tile URLs
 * still carry it, so restrict it in Google Cloud to this site's domain and to
 * the Map Tiles API only.
 *
 * Map Tiles API sessions last about two weeks; one is shared until a day before it expires.
 */

require_once __DIR__ . '/lib/json-api.php';
require_once __DIR__ . '/lib/staff-session.php';

const GOOGLE_TILE_API = 'https://tile.googleapis.com';

/** @return array{status: int, body: array<string, mixed>} */
function google_request(string $method, string $url, ?array $json = null): array {
    // A key restricted to the website checks the Referer, which a server call lacks; send the site's own.
    $host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $headers = "Referer: https://$host/\r\n" . ($json !== null ? "Content-Type: application/json\r\n" : '');
    $opts = [
        'http' => [
            'method'        => $method,
            'header'        => $headers,
            'content'       => $json !== null ? json_encode($json) : '',
            'timeout'       => 10,
            'ignore_errors' => true,
        ],
    ];
    $raw = @file_get_contents($url, false, stream_context_create($opts));
    $status = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
            $status = (int) $m[1];
        }
    }
    $body = is_string($raw) ? json_decode($raw, true) : null;
    return ['status' => $status, 'body' => is_array($body) ? $body : []];
}

/** A satellite session, reused from the temp dir while it has more than a day left. */
function google_session(string $key): array {
    $file = sys_get_temp_dir() . '/brylliant-gmaps-' . substr(hash('sha256', $key), 0, 16) . '.json';
    $cached = is_readable($file) ? json_decode((string) file_get_contents($file), true) : null;
    if (is_array($cached) && (int) ($cached['expiry'] ?? 0) > time() + 86400 && is_string($cached['session'] ?? null)) {
        return $cached;
    }
    $res = google_request('POST', GOOGLE_TILE_API . '/v1/createSession?key=' . rawurlencode($key), [
        'mapType'  => 'satellite',
        'language' => 'en-US',
        'region'   => 'PH',
    ]);
    $session = $res['body']['session'] ?? null;
    if ($res['status'] !== 200 || !is_string($session)) {
        $why = $res['body']['error']['message'] ?? ('HTTP ' . $res['status']);
        throw new RuntimeException('Google Map Tiles createSession failed: ' . $why);
    }
    $out = ['session' => $session, 'expiry' => (int) ($res['body']['expiry'] ?? (time() + 7 * 86400))];
    @file_put_contents($file, json_encode($out), LOCK_EX);
    return $out;
}

require_owner();

$key = server_env('GOOGLE_MAPS_KEY');

try {
    if ($key === '') {
        reply(200, ['ok' => true, 'google' => null]);
    }
    $s = google_session($key);

    if (isset($_GET['viewport'])) {
        $q = ['session' => $s['session'], 'key' => $key];
        foreach (['zoom', 'north', 'south', 'east', 'west'] as $p) {
            if (!is_numeric($_GET[$p] ?? null)) {
                reply(400, ['ok' => false, 'error' => "Missing $p."]);
            }
            $q[$p] = (string) (float) $_GET[$p];
        }
        $res = google_request('GET', GOOGLE_TILE_API . '/tile/v1/viewport?' . http_build_query($q));
        if ($res['status'] !== 200) {
            throw new RuntimeException('Google viewport failed: HTTP ' . $res['status']);
        }
        reply(200, [
            'ok'           => true,
            'copyright'    => (string) ($res['body']['copyright'] ?? ''),
            'maxZoomRects' => $res['body']['maxZoomRects'] ?? [],
        ]);
    }

    reply(200, ['ok' => true, 'google' => ['key' => $key, 'session' => $s['session'], 'expiry' => $s['expiry']]]);
} catch (Throwable $e) {
    error_log('imagery.php: ' . $e->getMessage());
    // The design tool falls back to Esri rather than showing no map.
    reply(200, ['ok' => true, 'google' => null, 'error' => 'Google imagery is not available right now; using Esri.']);
}
