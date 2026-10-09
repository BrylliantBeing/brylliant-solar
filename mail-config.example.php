<?php

/**
 * TEMPLATE — copy this to the server, never commit the filled-in version.
 *
 * Upload the real file to, one level ABOVE your document root:
 *
 *     /home/u327442596/domains/brylliant.solar/private/mail-config.php
 *
 * That location is deliberate:
 *   - it is outside public_html, so the file can never be fetched over HTTP;
 *   - Hostinger's Git deploy only replaces the document root, so redeploys
 *     will not delete it.
 *
 * Create the mailbox first in hPanel -> Emails -> Email Accounts. The password
 * below is that MAILBOX's password, not your hPanel login.
 */

return [
    // Hostinger's outgoing mail server. Confirm in hPanel -> Emails -> Configuration.
    'host' => 'smtp.hostinger.com',

    // 465 = implicit SSL. This is what Hostinger recommends by default.
    'port' => 465,

    // Full email address, used both to authenticate and as the From: address.
    'user' => 'website@brylliant.solar',
    'pass' => 'the-mailbox-password',

    // Where the leads land. Can be the same mailbox, or your day-to-day inbox.
    'to'   => 'survey@brylliant.solar',
];
