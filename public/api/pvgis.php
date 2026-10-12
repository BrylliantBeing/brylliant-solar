<?php
declare(strict_types=1);

/**
 * Brylliant Solar — sun data for the PV design tool, from the EU's PVGIS. Owner only.
 *
 *   GET /api/pvgis.php?lat=6.93&lon=122.09&angle=25&aspect=0
 *       -> { ok, monthly: [12 × kWh/kWp/day], daily, source }
 *   GET /api/pvgis.php?lat=6.93&lon=122.09&optimal=1
 *       -> the same for the best fixed orientation, plus { angle, aspect }
 *
 * aspect is PVGIS's: 0 south, -90 east, 90 west, 180 north. Figures are PVGIS's
 * E_d with its 14% system loss; the design tool takes its own calibration off
 * those (see yieldDeratePct in calculator/src/pvDesign.ts).
 *
 * PVGIS does not answer browser requests, so this fetches it server side. Its
 * figures are a 2005–2023 average and do not change, so answers are cached on
 * disk for 90 days, keyed by inputs rounded to 0.01° of position, 1° of tilt
 * and 5° of facing.
 */

require_once __DIR__ . '/lib/json-api.php';
require_once __DIR__ . '/lib/staff-session.php';

const PVGIS_URL = 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc';
const PVGIS_CACHE_DAYS = 90;

require_owner();

$num = static fn (string $k): ?float => is_numeric($_GET[$k] ?? null) ? (float) $_GET[$k] : null;
$lat = $num('lat');
$lon = $num('lon');
if ($lat === null || $lon === null || abs($lat) > 90 || abs($lon) > 180) {
    reply(400, ['ok' => false, 'error' => 'Give lat and lon.']);
}
$optimal = isset($_GET['optimal']);
$q = [
    'lat'          => number_format(round($lat, 2), 2, '.', ''),
    'lon'          => number_format(round($lon, 2), 2, '.', ''),
    'peakpower'    => '1',
    'loss'         => '14',
    'outputformat' => 'json',
];
if ($optimal) {
    $q['optimalangles'] = '1';
} else {
    $angle = $num('angle');
    $aspect = $num('aspect');
    if ($angle === null || $aspect === null) {
        reply(400, ['ok' => false, 'error' => 'Give angle and aspect, or optimal=1.']);
    }
    $q['angle'] = (string) max(0, min(90, (int) round($angle)));
    $a = (int) (round($aspect / 5) * 5);
    $q['aspect'] = (string) ($a > 180 ? $a - 360 : ($a < -180 ? $a + 360 : $a));
}

$file = sys_get_temp_dir() . '/brylliant-pvgis-' . substr(hash('sha256', http_build_query($q)), 0, 24) . '.json';
if (is_readable($file) && filemtime($file) > time() - PVGIS_CACHE_DAYS * 86400) {
    $cached = json_decode((string) file_get_contents($file), true);
    if (is_array($cached)) {
        reply(200, ['ok' => true] + $cached);
    }
}

$raw = @file_get_contents(PVGIS_URL . '?' . http_build_query($q), false, stream_context_create([
    'http' => ['timeout' => 30, 'ignore_errors' => true, 'header' => "Accept: application/json\r\n"],
]));
$body = is_string($raw) ? json_decode($raw, true) : null;
$months = $body['outputs']['monthly']['fixed'] ?? null;
if (!is_array($months) || count($months) !== 12) {
    $why = is_array($body) ? (string) ($body['message'] ?? 'unexpected reply') : 'no reply';
    error_log('pvgis.php: ' . $why);
    reply(502, ['ok' => false, 'error' => "PVGIS is not answering ($why). The sun analysis needs it; the layout still works."]);
}

$meteo = $body['inputs']['meteo_data'] ?? [];
$out = [
    'monthly' => array_map(static fn (array $m): float => (float) $m['E_d'], $months),
    'daily'   => (float) ($body['outputs']['totals']['fixed']['E_d'] ?? 0),
    'source'  => sprintf('%s, %s–%s', $meteo['radiation_db'] ?? 'PVGIS', $meteo['year_min'] ?? '', $meteo['year_max'] ?? ''),
];
if ($optimal) {
    $out['angle'] = (float) ($body['inputs']['mounting_system']['fixed']['slope']['value'] ?? 0);
    $out['aspect'] = (float) ($body['inputs']['mounting_system']['fixed']['azimuth']['value'] ?? 0);
}
@file_put_contents($file, json_encode($out), LOCK_EX);
reply(200, ['ok' => true] + $out);
