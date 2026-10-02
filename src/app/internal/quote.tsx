import {
  ZAMBOANGA_DEFAULTS,
  calculateQuote,
  parseOutageCsv,
  parseZamboangaDateTime,
  formatWallTime,
  type DateOrder,
  type QuoteResult,
} from '@calculator/solarQuoteCalculator';
import { ZAMCELCO_OUTAGES_CSV } from '@calculator/zamcelcoOutages';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { InternalPage } from '@/components/internal/internal-page';
import {
  DataSourceInput,
  KeyValue,
  MessageList,
  MultiSelect,
  NumberInput,
  Panel,
  SmallButton,
  Table,
  type DataSource,
} from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Stat } from '@/components/ui/kit';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  ASSUMPTION_GROUPS,
  NUMBER_FIELDS,
  TOGGLE_FIELDS,
  defaultFieldText,
  defaultToggles,
  displayValue,
  consumptionXlsxToCsv,
  num,
  runtimeLabel,
  runtimeText,
  parseConsumptionCsv,
  payback,
  peso,
  quoteSummaryText,
  readAssumptions,
  sampleConsumptionCsv,
  sampleOutageCsv,
  usd,
} from '@/lib/quote-input';
import { fetchUsdToPhp, type UsdRate } from '@/lib/exchange-rate';
import { getQuote, manilaTime, saveQuote, type QuoteInputs, type SavedQuoteSummary } from '@/lib/quotes-api';

const EMPTY: DataSource = { text: '', fileName: null };
const DATE_ORDERS: { label: string; value: DateOrder | undefined }[] = [
  { label: 'Auto-detect', value: undefined },
  { label: 'Day first (31/12)', value: 'DMY' },
  { label: 'Month first (12/31)', value: 'MDY' },
];

/** Every quote is computed from these, so any change marks the result stale. */
type Inputs = QuoteInputs;

const freshInputs = (usdToPhp?: number): Inputs => ({
  consumption: EMPTY,
  outages: EMPTY,
  locations: [],
  dateOrder: undefined,
  fields: defaultFieldText(usdToPhp),
  toggles: defaultToggles(),
});

/** Saved quotes from before multi-select stored one `location`. */
function savedLocations(inputs: Partial<Inputs> & { location?: string | null }): string[] {
  return inputs.locations ?? (inputs.location ? [inputs.location] : []);
}

export default function QuoteCalculator() {
  const t = useTheme();
  const wide = useWindowDimensions().width >= 1000;

  const { id: idParam } = useLocalSearchParams<{ id?: string }>();
  const [customer, setCustomer] = useState('');
  const [inputs, setInputs] = useState<Inputs>(() => freshInputs());
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [result, setResult] = useState<{ quote: QuoteResult; inputs: Inputs } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  /** The database copy this screen is editing, and what it held when last saved. */
  const [saved, setSaved] = useState<{ summary: SavedQuoteSummary; quote: QuoteResult; customer: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ id: number; message: string } | null>(null);
  /** Set by "Start a new quote" so the old ?id isn't reopened before the URL updates. */
  const [dismissedId, setDismissedId] = useState(0);

  /** Live USD → PHP rate, fetched once when the page opens. */
  const [liveRate, setLiveRate] = useState<UsdRate | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  /** True while the inputs came from a saved quote, whose own rate must be kept. */
  const fromSaved = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    fetchUsdToPhp(abort.signal)
      .then((r) => {
        setLiveRate(r);
        const fallback = defaultFieldText().usdToPhp;
        // Fill in the live rate unless staff already typed one or a saved quote is open.
        setInputs((prev) =>
          fromSaved.current || prev.fields.usdToPhp !== fallback
            ? prev
            : { ...prev, fields: { ...prev.fields, usdToPhp: defaultFieldText(r.rate).usdToPhp } },
        );
      })
      .catch((e: Error) => {
        if (!abort.signal.aborted) setRateError(e.message);
      });
    return () => abort.abort();
  }, []);

  // Open a saved quote from /internal/quote?id=12
  const openId = Number(idParam) || 0;
  const loadingId =
    openId && openId !== saved?.summary.id && openId !== loadError?.id && openId !== dismissedId ? openId : 0;
  useEffect(() => {
    if (!loadingId) return;
    let live = true;
    getQuote(loadingId)
      .then((q) => {
        if (!live) return;
        const loaded: Inputs = {
          ...freshInputs(),
          ...q.inputs,
          locations: savedLocations(q.inputs),
          fields: { ...defaultFieldText(), ...q.inputs.fields },
        };
        fromSaved.current = true;
        setInputs(loaded);
        setCustomer(q.customer);
        setResult({ quote: q.result, inputs: loaded });
        setSaved({ summary: q, quote: q.result, customer: q.customer });
        setError(null);
        setSaveError(null);
      })
      .catch((e: Error) => live && setLoadError({ id: loadingId, message: e.message }));
    return () => {
      live = false;
    };
  }, [loadingId]);

  const set = <K extends keyof Inputs>(key: K, value: Inputs[K]) => setInputs((prev) => ({ ...prev, [key]: value }));

  /* ---- live previews of what the files contain ---- */

  const consumption = useMemo(
    () => (inputs.consumption.text.trim() ? parseConsumptionCsv(inputs.consumption.text) : null),
    [inputs.consumption.text],
  );
  const consumptionRange = useMemo(() => {
    if (!consumption || consumption.readings.length === 0) return null;
    const r = consumption.readings;
    try {
      const a = parseZamboangaDateTime(r[0].timestamp, inputs.dateOrder);
      const b = parseZamboangaDateTime(r[r.length - 1].timestamp, inputs.dateOrder);
      return { text: `${formatWallTime(a).replace('T', ' ').slice(0, 16)} → ${formatWallTime(b).replace('T', ' ').slice(0, 16)}` };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [consumption, inputs.dateOrder]);

  const allOutages = useMemo(
    () => (inputs.outages.text.trim() ? parseOutageCsv(inputs.outages.text, { dateOrder: inputs.dateOrder }) : null),
    [inputs.outages.text, inputs.dateOrder],
  );
  const outages = useMemo(
    () =>
      inputs.outages.text.trim() && inputs.locations.length > 0
        ? parseOutageCsv(inputs.outages.text, { locations: inputs.locations, dateOrder: inputs.dateOrder })
        : allOutages,
    [inputs.outages.text, inputs.locations, inputs.dateOrder, allOutages],
  );
  const locationOptions = useMemo(
    () =>
      Object.entries(allOutages?.locations ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => ({ value: name, label: name, count })),
    [allOutages],
  );

  const assumptions = readAssumptions(inputs.fields, inputs.toggles);
  const defaults = defaultFieldText(liveRate?.rate);
  const editedCount =
    NUMBER_FIELDS.filter((f) => inputs.fields[f.key] !== defaults[f.key]).length +
    TOGGLE_FIELDS.filter((f) => inputs.toggles[f.key] !== ZAMBOANGA_DEFAULTS[f.key]).length;

  const stale = result !== null && result.inputs !== inputs;

  /* ---- actions ---- */

  function calculate() {
    setError(null);
    if (!consumption || consumption.readings.length === 0) {
      setError('Add the customer’s hourly consumption first.');
      return;
    }
    if (assumptions.errors.length > 0) {
      setShowAssumptions(true);
      setError(`Fix these assumptions: ${assumptions.errors.join(', ')}.`);
      return;
    }
    const snapshot = inputs;
    setBusy(true);
    // Let "Calculating…" paint before the simulation holds the thread.
    setTimeout(() => {
      try {
        const quote = calculateQuote({
          ...assumptions.values,
          consumption: consumption.readings,
          outages: outages?.outages ?? [],
          dateOrder: snapshot.dateOrder,
        });
        setResult({ quote, inputs: snapshot });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 30);
  }

  function loadSample() {
    setInputs((prev) => ({
      ...prev,
      consumption: { text: sampleConsumptionCsv(), fileName: null },
      outages: { text: sampleOutageCsv(), fileName: null },
      locations: ['Zamboanga City'],
    }));
  }

  async function save(asNew: boolean) {
    if (!result || stale || saving) return;
    const name = customer.trim();
    if (!name) {
      setSaveError('Enter the customer name at the top of the form first.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const summary = await saveQuote({
        id: asNew ? undefined : saved?.summary.id,
        customer: name,
        inputs: result.inputs,
        result: result.quote,
      });
      setSaved({ summary, quote: result.quote, customer: name });
      router.setParams({ id: String(summary.id) });
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startNew() {
    fromSaved.current = false;
    setInputs(freshInputs(liveRate?.rate));
    setCustomer('');
    setResult(null);
    setSaved(null);
    setError(null);
    setSaveError(null);
    setLoadError(null);
    setDismissedId(openId);
    router.setParams({ id: undefined });
  }

  async function copySummary() {
    if (!result || Platform.OS !== 'web') return;
    try {
      await navigator.clipboard.writeText(quoteSummaryText(result.quote, customer.trim()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('The browser blocked copying to the clipboard.');
    }
  }

  /* ---- inputs column ---- */

  const inputsColumn = (
    <View style={{ gap: Spacing.three }}>
      <Panel title="Customer">
        <TextInput
          value={customer}
          onChangeText={setCustomer}
          placeholder="Name or site, for the summary"
          placeholderTextColor={t.textMuted}
          accessibilityLabel="Customer name"
          style={[styles.text, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }]}
        />
      </Panel>

      <Panel title="1 · Hourly consumption (required)">
        <ThemedText type="small" themeColor="textSecondary">
          At least one week of hourly kWh: <ThemedText type="code">timestamp,kWh</ThemedText> or{' '}
          <ThemedText type="code">date,hour,kWh</ThemedText>, with or without a header row, or the meter&apos;s
          .xlsx export (its consumption column is used, production is ignored).
        </ThemedText>
        <DataSourceInput
          value={inputs.consumption}
          onChange={(v) => set('consumption', v)}
          placeholder={'timestamp,kWh\n2026-09-07 00:00,0.55\n2026-09-07 01:00,0.52\n…'}
          onSample={loadSample}
          fromXlsx={consumptionXlsxToCsv}
        />
        {consumption ? (
          <View style={{ gap: Spacing.one }}>
            <KeyValue label="Hours read" value={num(consumption.readings.length)} />
            <KeyValue label="Total" value={`${num(consumption.totalKwh, 1)} kWh`} />
            {consumptionRange && 'text' in consumptionRange ? <KeyValue label="Period" value={consumptionRange.text ?? ''} /> : null}
            <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
              Read as: {consumption.columns}
            </ThemedText>
            {consumption.readings.length > 0 && consumption.readings.length < 168 ? (
              <MessageList title="Not enough data" tone="warn" items={[`Needs 168 hours (one week); this has ${consumption.readings.length}.`]} />
            ) : null}
            {consumptionRange && 'error' in consumptionRange ? (
              <MessageList title="Dates" tone="warn" items={[consumptionRange.error ?? '']} />
            ) : null}
            <MessageList
              title={`${consumption.skipped.length} rows left out`}
              tone="warn"
              items={consumption.skipped.slice(0, 5).map((s) => `Line ${s.line}: ${s.reason}`)}
            />
          </View>
        ) : null}
      </Panel>

      <Panel title="2 · Outage history (optional)">
        <ThemedText type="small" themeColor="textSecondary">
          <ThemedText type="code">location,start,end</ThemedText> per outage. Sizes the battery. Without
          it the quote uses the minimum battery. A location cell can list several barangays separated by
          <ThemedText type="code">;</ThemedText>.
        </ThemedText>
        <View style={styles.chips}>
          <SmallButton
            label="Use ZAMCELCO interruptions"
            onPress={() =>
              setInputs((prev) => ({ ...prev, outages: { text: ZAMCELCO_OUTAGES_CSV, fileName: 'ZAMCELCO interruptions (built in)' }, locations: [] }))
            }
          />
        </View>
        <DataSourceInput
          value={inputs.outages}
          onChange={(v) => setInputs((prev) => ({ ...prev, outages: v, locations: [] }))}
          placeholder={'Location,Datetime Start,Datetime End\nZamboanga City,2026-03-27 16:30,2026-03-27 18:00\n…'}
        />
        {locationOptions.length > 1 ? (
          <>
            <ThemedText type="eyebrow" themeColor="textMuted">
              Location / barangay
            </ThemedText>
            <MultiSelect
              options={locationOptions}
              selected={inputs.locations}
              onChange={(v) => set('locations', v)}
              allLabel={`All ${locationOptions.length} locations`}
              noun="barangays"
              searchPlaceholder="Search barangays…"
            />
          </>
        ) : null}
        {outages ? (
          <View style={{ gap: Spacing.one }}>
            <KeyValue label="Outages used" value={num(outages.outages.length)} />
            {outages.firstStart ? (
              <KeyValue label="Period" value={`${outages.firstStart.slice(0, 10)} → ${outages.lastEnd?.slice(0, 10)}`} />
            ) : null}
            {outages.duplicatesRemoved > 0 ? <KeyValue label="Duplicates removed" value={num(outages.duplicatesRemoved)} /> : null}
            {outages.overlapsRemoved > 0 ? <KeyValue label="Inside a longer outage" value={num(outages.overlapsRemoved)} /> : null}
            <MessageList
              title="Outage file"
              tone="warn"
              items={[
                ...outages.warnings,
                ...outages.skipped.slice(0, 5).map((s) => `Line ${s.line}: ${s.reason}`),
              ]}
            />
          </View>
        ) : null}
      </Panel>

      <Panel title="Date format in the files">
        <View style={styles.chips}>
          {DATE_ORDERS.map((o) => (
            <Chip key={o.label} label={o.label} selected={inputs.dateOrder === o.value} onPress={() => set('dateOrder', o.value)} />
          ))}
        </View>
        <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
          Only matters for numeric dates like 04/09/2026. Auto-detect works whenever some day in the file is above 12.
        </ThemedText>
      </Panel>

      <Panel
        title={`3 · Prices & assumptions${editedCount ? ` · ${editedCount} edited` : ''}`}
        right={<SmallButton label={showAssumptions ? 'Hide' : 'Show'} onPress={() => setShowAssumptions((v) => !v)} />}>
        {showAssumptions ? (
          <View style={{ gap: Spacing.three }}>
            {ASSUMPTION_GROUPS.map((g) => (
              <View key={g.title} style={{ gap: Spacing.two }}>
                <ThemedText type="smallBold">{g.title}</ThemedText>
                <View style={styles.fields}>
                  {g.numbers.map((f) => (
                    <NumberInput
                      key={f.key}
                      label={f.label}
                      unit={f.unit}
                      help={f.help}
                      value={inputs.fields[f.key]}
                      changed={inputs.fields[f.key] !== defaults[f.key]}
                      onChange={(v) => set('fields', { ...inputs.fields, [f.key]: v })}
                    />
                  ))}
                </View>
                {g.toggles?.map((f) => (
                  <View key={f.key} style={{ gap: Spacing.one }}>
                    <ThemedText type="eyebrow" style={{ color: inputs.toggles[f.key] !== ZAMBOANGA_DEFAULTS[f.key] ? t.accentWarm : t.textMuted }}>
                      {f.label}
                    </ThemedText>
                    <View style={styles.chips}>
                      <Chip label="Yes" selected={inputs.toggles[f.key]} onPress={() => set('toggles', { ...inputs.toggles, [f.key]: true })} />
                      <Chip label="No" selected={!inputs.toggles[f.key]} onPress={() => set('toggles', { ...inputs.toggles, [f.key]: false })} />
                    </View>
                    <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
                      {f.help}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ))}
            {editedCount > 0 ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <SmallButton
                  label="Reset all to defaults"
                  onPress={() => setInputs((prev) => ({ ...prev, fields: defaultFieldText(), toggles: defaultToggles() }))}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <ThemedText type="small" themeColor="textMuted">
            Panel {usd(ZAMBOANGA_DEFAULTS.panelPriceUsd)} × {ZAMBOANGA_DEFAULTS.panelWatts} W · inverter{' '}
            {usd(ZAMBOANGA_DEFAULTS.inverterPriceUsd)} × {ZAMBOANGA_DEFAULTS.inverterKw} kW (max{' '}
            {ZAMBOANGA_DEFAULTS.inverterMaxPanels} panels) · battery {usd(ZAMBOANGA_DEFAULTS.batteryPriceUsd)} ×{' '}
            {ZAMBOANGA_DEFAULTS.batteryUnitKwh} kWh · target{' '}
            {displayValue(NUMBER_FIELDS.find((f) => f.key === 'targetReduction')!, ZAMBOANGA_DEFAULTS.targetReduction)}%
            {editedCount ? ' (defaults shown; your edits apply)' : ''}
          </ThemedText>
        )}
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
          {`Quote uses ₱${inputs.fields.usdToPhp} per US$. `}
          {liveRate
            ? `Live rate ₱${liveRate.rate.toFixed(2)}, ${liveRate.source}, updated ${manilaTime(liveRate.updatedAt)}.`
            : rateError
              ? `Live rate unavailable (${rateError}); using the saved fallback. Check it under Show.`
              : 'Fetching live rate…'}
        </ThemedText>
      </Panel>

      <Button label={busy ? 'Calculating…' : result ? 'Recalculate quote' : 'Calculate quote'} onPress={calculate} tone="sun" full />
      {error ? <MessageList title="Could not calculate" tone="warn" items={[error]} /> : null}
    </View>
  );

  /* ---- results column ---- */

  const unsaved = result !== null && (saved === null || saved.quote !== result.quote || saved.customer !== customer.trim());
  const saveBar = result ? (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.actions}>
        {saved ? (
          <>
            <SmallButton label={saving ? 'Saving…' : 'Save changes'} onPress={() => save(false)} strong={unsaved} />
            <SmallButton label="Save as new" onPress={() => save(true)} />
          </>
        ) : (
          <SmallButton label={saving ? 'Saving…' : 'Save quote'} onPress={() => save(true)} strong />
        )}
        {Platform.OS === 'web' ? <SmallButton label={copied ? 'Copied ✓' : 'Copy summary'} onPress={copySummary} /> : null}
      </View>
      <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
        {saved
          ? `Quote #${saved.summary.id} · saved ${manilaTime(saved.summary.updatedAt)} by ${saved.summary.updatedBy}` +
            (unsaved ? ' · unsaved changes' : '')
          : 'Not saved yet'}
        {stale ? ' · recalculate before saving' : ''}
      </ThemedText>
      {saveError ? <MessageList title="Could not save" tone="warn" items={[saveError]} /> : null}
    </View>
  ) : null;

  const resultsColumn = loadingId ? (
    <View style={[styles.empty, { borderColor: t.lineStrong, alignItems: 'flex-start' }]}>
      <ActivityIndicator color={t.accent} />
      <ThemedText type="small" themeColor="textSecondary">
        Opening quote #{loadingId}…
      </ThemedText>
    </View>
  ) : loadError && loadError.id === openId ? (
    <MessageList title={`Could not open quote #${loadError.id}`} tone="warn" items={[loadError.message]} />
  ) : result ? (
    <Results quote={result.quote} customer={customer.trim()} stale={stale} actions={saveBar} />
  ) : (
    <View style={[styles.empty, { borderColor: t.lineStrong }]}>
      <ThemedText type="heading">No quote yet</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Add the consumption file, optionally the outage history, then calculate. Use the sample data to see how it works.
      </ThemedText>
    </View>
  );

  return (
    <InternalPage
      eyebrow="Quote"
      title="Hybrid quote calculator"
      lede="Sizes panels, inverters and batteries for a 95% bill reduction. It simulates a year hour by hour from the customer’s highest-use week, the Zamboanga sun profile and the outage history.">
      {saved || result ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <SmallButton label="Start a new quote" onPress={startNew} />
        </View>
      ) : null}
      {wide ? (
        <View style={styles.columns}>
          <View style={{ width: 430 }}>{inputsColumn}</View>
          <View style={{ flex: 1, minWidth: 0 }}>{resultsColumn}</View>
        </View>
      ) : (
        <View style={{ gap: Spacing.four }}>
          {inputsColumn}
          {resultsColumn}
        </View>
      )}
    </InternalPage>
  );
}

function Results({
  quote: q,
  customer,
  stale,
  actions,
}: {
  quote: QuoteResult;
  customer: string;
  stale: boolean;
  actions: ReactNode;
}) {
  const t = useTheme();
  const { annualSaving, years } = payback(q);
  const hardware = q.pricing.panels + q.pricing.inverters + q.pricing.batteries;
  // Quotes saved before USD pricing have no rate or USD figures.
  const fx = q.pricing.usdToPhp ? { rate: q.pricing.usdToPhp, usd: q.pricing.usd } : null;
  const each = (count: number, php: number, usdTotal?: number) =>
    usdTotal !== undefined && count
      ? `${count} × ${usd(usdTotal / count)} = ${usd(usdTotal)}`
      : `${count} × ${peso(php / Math.max(1, count))}`;
  const monthly = q.bill.monthly;
  const sum = (pick: (m: (typeof monthly)[number]) => number) => monthly.reduce((a, m) => a + pick(m), 0);

  return (
    <View style={{ gap: Spacing.three, opacity: stale ? 0.55 : 1 }}>
      {stale ? (
        <View style={[styles.stale, { backgroundColor: t.sun }]}>
          <ThemedText type="smallBold" style={{ color: '#171C19' }}>
            Inputs changed. Recalculate to update this quote.
          </ThemedText>
        </View>
      ) : null}

      <ThemedText type="subtitle">{customer ? `Quote · ${customer}` : 'Quote'}</ThemedText>
      {actions}

      <MessageList title="Check before sending" tone="warn" items={q.warnings} />

      <View style={styles.stats}>
        <Stat hero label="Total price" value={peso(q.pricing.total)} sub={years !== null ? `Simple payback ≈ ${num(years, 1)} years` : 'No bill saving'} />
        <Stat label="Panels" value={`${num(q.panels.systemKw, 2)} kWp`} sub={`${q.panels.count} × ${q.panels.wattsEach} W`} />
        <Stat
          label="Inverter"
          value={`${num(q.inverter.totalKw)} kW`}
          sub={
            `${q.inverter.count} × ${q.inverter.ratingKwEach} kW · DC/AC ${num(q.inverter.dcAcRatio, 2)}` +
            (q.inverter.maxPanelsEach ? ` · ≤${q.inverter.maxPanelsEach} panels each` : '')
          }
        />
        <Stat
          label="Battery"
          value={`${num(q.battery.installedKwh, 1)} kWh`}
          sub={`${q.battery.units} unit${q.battery.units === 1 ? '' : 's'} · ${num(q.battery.dailyUsableKwh, 1)} kWh usable daily`}
        />
        <Stat
          label="Monthly bill"
          value={peso(q.bill.averageMonthlyAfter)}
          sub={`from ${peso(q.bill.averageMonthlyBefore)} · ${num(q.bill.reductionPercent, 1)}% lower`}
        />
        <Stat label="Saving" value={`${peso(annualSaving)}/yr`} sub={`${peso(annualSaving / 12)} a month on average`} />
      </View>

      <Panel title={fx ? `Price breakdown · US$1 = ₱${num(fx.rate, 2)}` : 'Price breakdown'}>
        <KeyValue label="Panels" sub={each(q.panels.count, q.pricing.panels, fx?.usd.panels)} value={peso(q.pricing.panels)} />
        <KeyValue
          label="Inverters"
          sub={
            each(q.inverter.count, q.pricing.inverters, fx?.usd.inverters) +
            (q.inverter.countForPanels > q.inverter.countForLoad ? ` · ${q.inverter.countForPanels} needed for the panels` : '')
          }
          value={peso(q.pricing.inverters)}
        />
        <KeyValue label="Batteries" sub={q.battery.units ? each(q.battery.units, q.pricing.batteries, fx?.usd.batteries) : undefined} value={peso(q.pricing.batteries)} />
        <KeyValue
          label="Mounting & cabling"
          sub={`${num(hardware > 0 ? (q.pricing.mountingCabling / hardware) * 100 : 0)}% of ${peso(hardware)} hardware`}
          value={peso(q.pricing.mountingCabling)}
        />
        <KeyValue label="Labour" value={peso(q.pricing.labor)} />
        <KeyValue label="Miscellaneous" value={peso(q.pricing.misc)} />
        <KeyValue label="Total" value={peso(q.pricing.total)} total />
      </Panel>

      <Panel title={`Simulated year · ${q.simulation.start.slice(0, 7)} to ${q.bill.monthly[monthly.length - 1]?.month ?? ''}`}>
        <Table
          head={['Month', 'Use kWh', 'Import kWh', 'Export kWh', 'Bill before', 'Bill after', 'Credit c/f']}
          rows={monthly.map((m) => [
            m.month,
            num(m.consumptionKwh),
            num(m.importKwh),
            num(m.exportKwh),
            peso(m.billBefore),
            peso(m.billAfter),
            peso(m.creditCarriedOut),
          ])}
          foot={[
            'Year',
            num(sum((m) => m.consumptionKwh)),
            num(sum((m) => m.importKwh)),
            num(sum((m) => m.exportKwh)),
            peso(q.bill.annualBefore),
            peso(q.bill.annualAfter),
            peso(q.bill.unusedCreditAtYearEnd),
          ]}
        />
      </Panel>

      <View style={styles.pair}>
        <View style={styles.pairCell}>
          <Panel title="Energy over the year">
            <KeyValue label="Consumption" value={`${num(q.energy.annualConsumptionKwh)} kWh`} />
            <KeyValue label="Solar generated" value={`${num(q.energy.annualSolarKwh)} kWh`} />
            <KeyValue label="Imported" value={`${num(q.energy.annualImportKwh)} kWh`} />
            <KeyValue label="Exported" value={`${num(q.energy.annualExportKwh)} kWh`} />
            <KeyValue label="Curtailed" value={`${num(q.energy.annualCurtailedKwh)} kWh`} />
            <KeyValue label="Peak hourly load" value={`${num(q.inverter.peakHourlyLoadKwh, 2)} kWh`} />
          </Panel>
        </View>
        <View style={styles.pairCell}>
          <Panel title="Battery & outages">
            <KeyValue label="Outages analysed" value={num(q.battery.outagesAnalyzed)} sub={q.battery.outagesSkipped ? `${q.battery.outagesSkipped} unreadable` : undefined} />
            <KeyValue
              label="Need per outage"
              value={`${num(q.battery.needStats.median, 1)} kWh`}
              sub={`median · min ${num(q.battery.needStats.min, 1)} · max ${num(q.battery.needStats.max, 1)}`}
            />
            <KeyValue label="Sized for (percentile)" value={`${num(q.battery.requiredKwh, 1)} kWh`} />
            {q.outageRuntime
              ? ([
                ['peak sun', q.outageRuntime.peakSun],
                ['after sunset', q.outageRuntime.afterSunset],
              ] as const).map(([when, r]) => (
                <KeyValue
                  key={when}
                  label={`${runtimeLabel(r.startHour)} (${when})`}
                  value={runtimeText(r.medianHours, q.outageRuntime.maxHours)}
                  sub={
                    `typical · shortest ${runtimeText(r.shortestHours, q.outageRuntime.maxHours)} · ` +
                    `starts with ${num(r.medianStartKwh, 1)} kWh stored`
                  }
                />
              ))
              : null}
            <KeyValue
              label="Covered in simulated year"
              value={`${q.outageCoverage.eventsFullyCovered} of ${q.outageCoverage.eventsInSimulatedYear}`}
              sub={q.outageCoverage.unmetLoadKwh ? `${num(q.outageCoverage.unmetLoadKwh, 1)} kWh unmet` : undefined}
            />
          </Panel>
        </View>
      </View>

      <Panel title="Reference week (highest-use day per weekday)">
        <View style={styles.refDays}>
          {Object.entries(q.battery.referenceDays).map(([day, date]) => (
            <View key={day} style={[styles.refDay, { borderColor: t.line }]}>
              <ThemedText type="eyebrow" themeColor="textMuted">
                {day.slice(0, 3)}
              </ThemedText>
              <ThemedText type="data" style={{ fontSize: 12 }}>
                {date ?? 'fallback'}
              </ThemedText>
            </View>
          ))}
        </View>
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
          Sun: {q.simulation.sunProfileSource} · sizing rounds: {q.simulation.sizingIterations}
          {q.simulation.converged ? '' : ' (did not converge)'}
        </ThemedText>
      </Panel>

      <MessageList title="How this quote was built" tone="note" items={q.notes} />
    </View>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  text: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: Radius.md, padding: Spacing.four, gap: Spacing.two },
  stale: { borderRadius: Radius.sm, padding: Spacing.three },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  pairCell: { flexGrow: 1, flexBasis: 280 },
  refDays: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  refDay: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, gap: 2 },
});
