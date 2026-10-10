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
      job.tsx        job builder: a quote's bill of materials, editable (api/jobs.php)
      jobs.tsx       every job
      calendar.tsx   surveys, installations and permits (api/schedule.php, api/projects.php)
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

`book.tsx` posts to `public/api/quote.php`, which saves the request as a project
(it appears in the Surveys tab of the staff calendar) and emails it over SMTP
using the `MAIL_*` variables in the table under "Internal pages". The customer
picks the days they are free on a calendar (2 to 30 days ahead, no Sundays) and, if they
give an email address, gets an automatic confirmation from the same script —
don't also turn on Hostinger's mailbox auto-reply, or it will answer the
website mailbox rather than the customer. If sending
fails and the request couldn't be saved either, the customer sees a summary to send on Messenger. To try it locally,
add `MAIL_*` lines to `.env.dev.local` and run `npm run dev:api`, `npm run dev:proxy`
and `npm run web`, then open http://localhost:3000/book.

## Internal pages (/internal)

Staff tools: a dashboard, the hybrid quote calculator, jobs, the jobs calendar,
and status checks (status is a placeholder for now).

All server settings are **environment variables in hPanel** (your site ->
Environment variables), never in git:

| Variable | Value |
|---|---|
| `STAFF_USERS` | owner sign-in that works without the database, from `npm run staff:hash`, joined with `;`; everyone else is added on the dashboard (see "Staff accounts") |
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
checks passwords against the dashboard accounts and `STAFF_USERS`. Sessions end
after 2 h idle or 12 h.

**Staff accounts are made on the dashboard.** Under "Staff accounts", the owner
adds people with a name, role and password (one is generated to pass on),
changes roles, resets passwords and removes accounts. These live in the MySQL
`staff` table and take effect at once, with no redeploy. A password reset or a
removal signs that person out everywhere, and a removal takes them off upcoming
bookings. An owner can't demote or remove themselves, so an owner always
remains.

The roles are `owner`, `lead_installer`, `installer` and `electrician`. The owner
sees everything; everyone else sees only the calendar, and on it only the
events they're booked on (name, address and phone, no bills or prices). The
calendar's default crews come from the roles: the first owner, lead installer
and electrician survey; the lead and the first two installers install; the
electrician inspects and handles permits.

**`STAFF_USERS` is the way in when there's no account yet** (a fresh deploy) or
the database is down. Its entries are `username:Name:hash:role` from
`npm run staff:hash`; an entry without a role is an owner, and one with a
misspelt role can't sign in. They show on the dashboard marked "in hPanel" and
can only be changed there (then redeploy). Keep your own owner entry in it.

**Saved quotes live in MySQL.** `public/api/lib/db.php` creates the `quotes`
table on first use. Each row keeps the uploaded CSVs, the assumptions and the
calculated result, so a quote reopens exactly as it was saved.

**Jobs and the calendar live in MySQL too**, in tables `db.php` also creates:
`projects` (one customer's pipeline, from a booking, a quote or typed in),
`jobs` (a quote's line items as edited), `events` + `event_staff` (calendar
bookings and who's on them) and `permits` (dates of each permit step). A job
books ceil(panels / 20) installation days plus one inspection day, skipping
Sundays; a survey is 3 hours. Clashes, and surveys outside the days or time of
day the customer asked for, are warned about, never refused. A survey request
can be rejected with a reason: it moves to a Rejected list (restorable), any
survey still to come for it comes off the calendar, and the customer is not
emailed.

Any future internal API (dashboards, status) must start with
`require __DIR__ . '/lib/staff-session.php'; require_owner();` (or
`require_staff()` if non-owners may use it, filtering what they see) — the page
gate alone hides the UI but cannot protect data.

In `npm run web` there is no PHP, so the sign-in screen offers a
"Continue as local dev" button. It only exists in development builds.

Known limit: the site ships as one JS bundle, so the calculator code and its
default prices (`ZAMBOANGA_DEFAULTS`) are downloadable by anyone who digs into
the public bundle. Move prices behind a `require_staff()` API if that matters.
