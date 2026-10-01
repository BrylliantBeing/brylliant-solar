<?php
declare(strict_types=1);

/**
 * Server settings from hPanel environment variables, never from git.
 *
 * PHP is asked first, in case the server passes the variables through. Hostinger
 * documents them only for the build, so scripts/write-server-env.js also copies
 * them into env.php next to this file during `npm run build:web`.
 */
function server_env(string $key): string {
    static $built = null;
    $runtime = getenv($key);
    if (is_string($runtime) && $runtime !== '') {
        return $runtime;
    }
    if ($built === null) {
        $file = __DIR__ . '/env.php';
        $built = is_readable($file) ? require $file : [];
        if (!is_array($built)) {
            $built = [];
        }
    }
    return (string) ($built[$key] ?? '');
}
