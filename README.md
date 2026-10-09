# Brylliant Solar

Universal Expo app for Brylliant Solar — solar distribution and installation in
Zamboanga City. One codebase runs as the marketing website (Expo Router static
web output) and as an iOS/Android app.

## Running it

```bash
npm install
npm run web        # website in a browser
npm run ios        # iOS simulator
npm run android    # Android emulator
```

## Where things live

```
src/
  app/
    _layout.tsx      root layout: (site) and internal side by side
    (site)/          the public website (the group doesn't change URLs)
      index.tsx      home — hero, packages, process, proof, FAQ, footer
      estimate.tsx   the savings estimator
      book.tsx       free-survey booking form
    internal/        staff-only pages behind sign-in — see "Internal pages"
      quote.tsx      hybrid quote calculator (calculator/ engine)
      saved.tsx      saved quotes (MySQL via api/quotes.php)
  components/
    brand-mark.tsx   the Vinta Sun logo, drawn with Views (no SVG dependency)
    themed-text.tsx  the type scale
    ui/kit.tsx       Card, Section, Button, Chip, Stat, Bullet, Callout
    app-tabs.tsx     native bottom tabs (iOS/Android)
    app-tabs.web.tsx top navigation bar (web)
  constants/
    theme.ts         brand palette, spacing, type
    solar.ts         **the pricing and sizing model — start here**
```

## The model

`src/constants/solar.ts` is the single source of truth for every number the app
shows. Change a value there and the estimator, the package cards and the worked
example on the home screen all follow.

### Real supplier quotes

| Item | Price |
|---|---|
| Jinko 720 Wp panel | $82.80 |
| Deye SUN-3K-SG04LP1-24 | $598 |
| Deye SUN-6K-SG04LP1 | $730 |
| Deye SUN-12K-SG02LP1 | $1,527 |

### Estimates that need replacing with measured costs

These were derived from the hardware above plus market comparison. They are the
first things to correct once real jobs are done.

| Assumption | Current | Note |
|---|---|---|
| Installed ₱/kWp, Standard | 45,000 | Market: grid-tie ₱33.5–38k, hybrid ₱43–68k |
| Installed ₱/kWp, Daylight | 58,000 | Small systems carry the fixed job cost |
| Battery ₱/kWh | 17,000 | **No supplier quote yet — get one** |
| Grid rate ₱/kWh | 12.00 | Re-check every billing month |
| Export credit ₱/kWh | 6.00 | Blended generation rate, not retail |
| Fixed charge ₱/month | 250 | Placeholder — read the real one off a bill |
| Yield kWh/kWp/day | 5.6 | Zamboanga annual average |
| Self-use % | 45 / 65 / 90 / 95 | Biggest lever in the model. Verify with monitoring data |

The fixed cost per job — permits, mobilisation, AC protection, scaffolding — is
what makes small systems unprofitable at market ₱/kWp. Track it precisely on the
first three installations.

## Before launch

- [ ] Replace placeholder contact details (footer, booking screen)
- [x] Wire the booking form to an inbox — set the `MAIL_*` variables below and
      redeploy
- [ ] Replace `assets/images/` icons and splash with the brand mark
- [ ] Add the brand typefaces (Bricolage Grotesque, Newsreader, IBM Plex Mono)
      via `expo-font`; the app currently uses platform system fonts
- [ ] Get a battery supplier quote and update `Model.batteryPerKwh`
- [ ] Confirm whether the hardware quotes are landed or FOB — if FOB, add ~21%
      for freight and VAT

## Theme

The app is light-only, matching the website. The dark palette is already defined
in `src/constants/theme.ts`; set `FORCE_LIGHT = false` in `src/hooks/use-theme.ts`
and `userInterfaceStyle` back to `"automatic"` in `app.json` to enable it.

## Booking form

`book.tsx` posts to `public/api/quote.php`, which emails the request over SMTP
using the `MAIL_*` variables in the table under "Internal pages". The customer
picks the days they are free on a calendar (2 to 30 days ahead, no Sundays) and, if they
give an email address, gets an automatic confirmation from the same script —
don't also turn on Hostinger's mailbox auto-reply, or it will answer the
website mailbox rather than the customer. If sending
fails, the customer still sees a summary to send on Messenger. To try it locally,
add `MAIL_*` lines to `.env.dev.local` and run `npm run dev:api`, `npm run dev:proxy`
and `npm run web`, then open http://localhost:3000/book.

## Internal pages (/internal)

Staff tools: a dashboard, the hybrid quote calculator, and status checks
(dashboard and status are placeholders for now).

All server settings are **environment variables in hPanel** (your site ->
Environment variables), never in git:

| Variable | Value |
|---|---|
| `STAFF_USERS` | staff accounts, one entry per person from `npm run staff:hash`, joined with `;` |
| `DB_NAME` | the MySQL database name (`u327442596_solar`) |
| `DB_USER` | the MySQL user |
| `DB_PASSWORD` | the MySQL user's password |
| `DB_HOST` | optional, defaults to `localhost` |
| `MAIL_USER` | booking form: the Hostinger mailbox it sends from, e.g. `website@brylliant.solar` |
| `MAIL_PASSWORD` | that mailbox's password (not your hPanel login) |
| `MAIL_TO` | optional, where survey requests land (e.g. `survey@brylliant.solar`); defaults to `MAIL_USER`. Customer confirmations use it as Reply-To |
| `MAIL_HOST`, `MAIL_PORT` | optional, default `smtp.hostinger.com` and `465` |

Hostinger gives these to the build, not to PHP, so `npm run build:web` ends with
`scripts/write-server-env.js`, which writes them to `dist/api/lib/env.php`
(blocked from the web by `api/lib/.htaccess`). **Hostinger's build command must
be `npm run build:web`, and after changing a variable you must redeploy** so the
build writes the new value.

**Sign-in is a PHP session**, not client-side state: `public/api/auth.php`
checks passwords against `STAFF_USERS`. To add someone, run `npm run staff:hash`,
type their username, name and password (hidden), and append the printed
`username:Name:hash` line to `STAFF_USERS` with a `;`. Remove an entry and
redeploy to revoke access; sessions also end after 2 h idle or 12 h.

**Saved quotes live in MySQL.** `public/api/lib/db.php` creates the `quotes`
table on first use. Each row keeps the uploaded CSVs, the assumptions and the
calculated result, so a quote reopens exactly as it was saved.

Any future internal API (dashboards, status) must start with
`require __DIR__ . '/lib/staff-session.php'; require_staff();` — the page gate
alone hides the UI but cannot protect data.

In `npm run web` there is no PHP, so the sign-in screen offers a
"Continue as local dev" button. It only exists in development builds.

Known limit: the site ships as one JS bundle, so the calculator code and its
default prices (`ZAMBOANGA_DEFAULTS`) are downloadable by anyone who digs into
the public bundle. Move prices behind a `require_staff()` API if that matters.
