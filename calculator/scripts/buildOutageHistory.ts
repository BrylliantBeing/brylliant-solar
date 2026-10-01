// scripts/buildOutageHistory.ts — run once in Node, not part of the app bundle.
//
//   npx tsx scripts/buildOutageHistory.ts outages.csv [--location "Zamboanga City"]
//        [--date-order DMY|MDY] [--allow-skipped]
//
// Reads the 6-year outage CSV (location, datetime start, datetime end) and writes
// src/outageHistory.json with unambiguous times. Stops if any row can't be read,
// unless --allow-skipped is passed, so a bad file never shrinks the battery silently.

import * as fs from 'fs';
import * as path from 'path';
import { DateOrder, parseOutageCsv } from '../src/solarQuoteCalculator';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/buildOutageHistory.ts <file.csv> [--location NAME] [--date-order DMY|MDY]');
  process.exit(1);
}

const result = parseOutageCsv(fs.readFileSync(file, 'utf8'), {
  locations: arg('--location'),
  dateOrder: arg('--date-order') as DateOrder | undefined,
});

console.log('Locations in file:');
Object.entries(result.locations).forEach(([loc, n]) => console.log(`  ${loc}: ${n}`));
console.log(`Date order: ${result.dateOrder ?? 'year-first or unambiguous'}`);
console.log(`Outages kept: ${result.outages.length} (${result.firstStart} to ${result.lastEnd})`);
console.log(`Duplicates removed: ${result.duplicatesRemoved}`);
result.warnings.forEach((w) => console.warn(`WARNING: ${w}`));

if (result.skipped.length > 0) {
  console.warn(`\n${result.skipped.length} rows skipped:`);
  result.skipped.slice(0, 20).forEach((s) => console.warn(`  line ${s.line}: ${s.reason}  [${s.raw}]`));
  if (!process.argv.includes('--allow-skipped')) {
    console.error('\nFix these rows or re-run with --allow-skipped. Nothing was written.');
    process.exit(1);
  }
}

const out = path.join(__dirname, '..', 'src', 'outageHistory.json');
fs.writeFileSync(out, JSON.stringify(result.outages, null, 2));
console.log(`Wrote ${out}`);
