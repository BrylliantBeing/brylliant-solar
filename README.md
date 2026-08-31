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
    _layout.tsx      root layout, brand navigation theme
    index.tsx        home — hero, packages, process, proof, FAQ, footer
    estimate.tsx     the savings estimator
    book.tsx         free-survey booking form
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
- [ ] Wire the booking form to an inbox, Messenger handoff or CRM — it currently
      validates and produces a summary for the customer to send
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
