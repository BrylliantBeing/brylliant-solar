import type { QuoteResult, SystemType } from '@calculator/solarQuoteCalculator';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { InternalPage } from '@/components/internal/internal-page';
import { JobBadge } from '@/components/internal/job-badge';
import { KeyValue, MessageList, NumberInput, Panel, SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/kit';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  JOB_CATEGORIES,
  byCategory,
  fitToCounts,
  itemTotal,
  itemsFromQuote,
  jobCounts,
  jobTotal,
  jobWarnings,
  newItemId,
  settingsFor,
  type JobItem,
  type JobSettings,
} from '@/lib/job-items';
import { deleteJob, getJob, saveJob, type JobSummary } from '@/lib/jobs-api';
import { loadPipeline, type Project } from '@/lib/projects-api';
import { num, peso, readAssumptions } from '@/lib/quote-input';
import { getQuote, manilaTime, type SavedQuote } from '@/lib/quotes-api';
import { installPlan } from '@/lib/schedule';

const SETTING_FIELDS: { key: keyof JobSettings; label: string; unit: string }[] = [
  { key: 'panelWatts', label: 'Panel rating', unit: 'W' },
  { key: 'inverterKw', label: 'Inverter rating', unit: 'kW' },
  { key: 'inverterMaxPanels', label: 'Panels per inverter', unit: 'max' },
  { key: 'maxDcAcRatio', label: 'Max DC/AC ratio', unit: '×' },
  { key: 'panelsPerString', label: 'Panels per string', unit: 'panels' },
  { key: 'pvCableMetersPerString', label: 'PV cable per string', unit: 'm' },
  { key: 'pvCableRollMeters', label: 'PV cable roll length', unit: 'm' },
  { key: 'batteryUnitKwh', label: 'Battery unit', unit: 'kWh' },
];

type Draft = {
  systemType: SystemType;
  items: JobItem[];
  settings: JobSettings;
  /** null = a new project named after the quote */
  projectId: number | null;
  quoteId: number | null;
};

const toNumber = (s: string) => Number(s.replace(/[,\s₱]/g, ''));

/** /internal/job?quote=12 starts a job from a saved quote; /internal/job?id=4 opens a saved job. */
export default function JobBuilder() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id?: string; quote?: string; system?: string }>();
  const jobId = Number(params.id) || 0;
  const quoteId = Number(params.quote) || 0;

  /** The job as edited; until the first edit of a new job, the quote's items (seed) stand in. */
  const [edited, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<{ summary: JobSummary | null; snapshot: string } | null>(null);
  const [quote, setQuote] = useState<SavedQuote | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetchError, setFetchError] = useState<{ key: string; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSpecs, setShowSpecs] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const fetchKey = `${jobId}-${quoteId}`;

  // Projects to attach the job to; the page still works without them.
  useEffect(() => {
    loadPipeline()
      .then((p) => setProjects(p.projects.filter((x) => x.status === 'active')))
      .catch(() => setProjects([]));
  }, []);

  // Open a saved job, or the quote a new one starts from.
  useEffect(() => {
    let live = true;
    const fail = (e: Error) => live && setFetchError({ key: fetchKey, message: e.message });
    if (jobId) {
      if (saved?.summary?.id === jobId) return;
      getJob(jobId)
        .then((job) => {
          if (!live) return;
          const d: Draft = {
            systemType: job.systemType,
            items: job.items,
            settings: job.settings,
            projectId: job.projectId,
            quoteId: job.quoteId,
          };
          setDraft(d);
          setSaved({ summary: job, snapshot: JSON.stringify(d) });
        })
        .catch(fail);
    } else if (quoteId) {
      getQuote(quoteId)
        .then((q) => live && setQuote(q))
        .catch(fail);
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, quoteId]);

  /** A quote with a grid-tie comparison asks which system the job is. */
  const system: SystemType | null =
    params.system === 'grid-tie' || params.system === 'hybrid' ? params.system : quote?.result.gridTie ? null : 'hybrid';

  /** A new job's starting point: the chosen system's quote, as line items. */
  const seed = useMemo((): Draft | null => {
    if (jobId || !quote || !system) return null;
    const { values } = readAssumptions(quote.inputs.fields, quote.inputs.toggles);
    const result: QuoteResult | undefined = system === 'grid-tie' ? quote.result.gridTie : quote.result;
    if (!result) return null;
    return {
      systemType: system,
      items: itemsFromQuote(result, values, system),
      settings: settingsFor(values, system),
      projectId: quote.projectId ?? null,
      quoteId: quote.id,
    };
  }, [jobId, quote, system]);
  const draft = edited ?? seed;

  const loadError =
    fetchError?.key === fetchKey
      ? fetchError.message
      : !jobId && !quoteId
        ? 'Open a job from the Jobs list, or start one from a saved quote.'
        : quote && system === 'grid-tie' && !quote.result.gridTie
          ? 'This quote has no grid-tie comparison.'
          : null;

  const update = (fn: (d: Draft) => Draft) =>
    setDraft((d) => {
      const base = d ?? seed;
      return base ? fn(base) : d;
    });
  const setItem = (id: string, patch: Partial<JobItem>) =>
    update((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  const derived = useMemo(() => {
    if (!draft) return null;
    const counts = jobCounts(draft.items, draft.settings);
    const quoted = draft.items.reduce(
      (s, i) => s + (i.defaultQty !== null && i.defaultUnitPrice !== null ? i.defaultQty * i.defaultUnitPrice : 0),
      0,
    );
    return {
      counts,
      total: jobTotal(draft.items),
      quoted,
      groups: byCategory(draft.items),
      warnings: jobWarnings(draft.items, draft.settings, draft.systemType),
      plan: installPlan(counts.panels),
    };
  }, [draft]);

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const summary = await saveJob({ id: saved?.summary?.id, ...draft });
      const next = { ...draft, projectId: summary.projectId };
      setDraft(next);
      setSaved({ summary, snapshot: JSON.stringify(next) });
      router.setParams({ id: String(summary.id), quote: undefined, system: undefined });
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!saved?.summary) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteJob(saved.summary.id);
      router.replace('/internal/jobs');
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  function addItem(category: string) {
    update((d) => ({
      ...d,
      items: [
        ...d.items,
        { id: newItemId(d.items), category, kind: 'custom', name: '', unit: '', qty: 1, unitPrice: 0, defaultQty: null, defaultUnitPrice: null },
      ],
    }));
  }

  const customer =
    projects.find((p) => p.id === draft?.projectId)?.customer ?? saved?.summary?.customer ?? quote?.customer ?? 'New job';

  /* ---- loading, errors and the system choice ---- */

  if (loadError) {
    return (
      <InternalPage eyebrow="Job" title="Job builder">
        <MessageList title="Could not open the job" tone="warn" items={[loadError]} />
        <View style={{ alignSelf: 'flex-start' }}>
          <SmallButton label="Back to jobs" onPress={() => router.push('/internal/jobs')} />
        </View>
      </InternalPage>
    );
  }
  if (!jobId && quote && !system) {
    const g = quote.result.gridTie!;
    return (
      <InternalPage eyebrow="New job" title={quote.customer} lede="This quote priced two systems. Which one is the customer getting?">
        <View style={styles.choices}>
          {(
            [
              ['hybrid', 'Hybrid, with batteries', quote.result],
              ['grid-tie', 'Grid-tie, no batteries', g],
            ] as const
          ).map(([value, label, r]) => (
            <Pressable
              key={value}
              onPress={() => router.setParams({ system: value })}
              accessibilityRole="button"
              style={({ pressed }) => [styles.choice, { borderColor: t.lineStrong, backgroundColor: t.backgroundElement }, pressed && { opacity: 0.7 }]}>
              <ThemedText type="heading">{label}</ThemedText>
              <ThemedText type="data" themeColor="textSecondary" style={{ fontSize: 12 }}>
                {r.panels.count} panels · {r.inverter.count} × {r.inverter.ratingKwEach} kW
                {r.battery.units ? ` · ${r.battery.units} batteries` : ''}
              </ThemedText>
              <ThemedText type="dataLarge" style={{ fontSize: 18, color: t.accent }}>
                {peso(r.pricing.total)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </InternalPage>
    );
  }
  if (!draft || !derived) {
    return (
      <InternalPage eyebrow="Job" title="Job builder">
        <ActivityIndicator color={t.accent} style={{ alignSelf: 'flex-start' }} />
      </InternalPage>
    );
  }

  /* ---- the job ---- */

  const unsaved = saved === null || saved.snapshot !== JSON.stringify(draft);
  const { counts, plan } = derived;
  const diff = derived.total - derived.quoted;
  const kwp = (counts.panels * draft.settings.panelWatts) / 1000;
  const categories = [...new Set([...JOB_CATEGORIES.filter((c) => derived.groups.some((g) => g.category === c)), ...derived.groups.map((g) => g.category)])];

  return (
    <InternalPage
      eyebrow={saved?.summary ? `Job #${saved.summary.id}` : 'New job'}
      title={customer}
      lede="Every line starts at what the quote priced. Change anything; the warnings say when the parts stop fitting together, but nothing is blocked.">
      <Card>
        <View style={styles.summaryTop}>
          <JobBadge kind="install" projectId={draft.projectId ?? 0} customer={customer} size={30} />
          <View style={{ flex: 1, minWidth: 200 }}>
            <ThemedText type="heading">
              {draft.systemType === 'grid-tie' ? 'Grid-tie' : 'Hybrid'} · {num(kwp, 2)} kWp
            </ThemedText>
            <ThemedText type="data" themeColor="textSecondary" style={{ fontSize: 12 }}>
              {counts.panels} panels · {counts.inverters} inverters
              {draft.systemType === 'hybrid' ? ` · ${counts.batteries} batteries` : ''} · {counts.strings} strings
            </ThemedText>
            <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
              Installation: {plan.installDays} day{plan.installDays === 1 ? '' : 's'} for the installers + {plan.inspectionDays} day
              for inspection and connections
            </ThemedText>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <ThemedText type="dataLarge" style={{ fontSize: 22, color: t.accent }}>
              {peso(derived.total)}
            </ThemedText>
            {Math.abs(diff) >= 1 ? (
              <ThemedText type="data" style={{ fontSize: 12, color: t.accentWarm }}>
                {diff > 0 ? '+' : '−'}
                {peso(Math.abs(diff))} vs the quote
              </ThemedText>
            ) : (
              <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
                Same as the quote
              </ThemedText>
            )}
          </View>
        </View>

        <View style={styles.actions}>
          <SmallButton label={saving ? 'Saving…' : saved?.summary ? 'Save changes' : 'Save job'} onPress={save} strong={unsaved} />
          <SmallButton label="Match parts to panels & inverters" onPress={() => update((d) => ({ ...d, items: fitToCounts(d.items, d.settings) }))} />
          <SmallButton
            label="Reset all to the quote"
            onPress={() =>
              update((d) => ({
                ...d,
                items: d.items
                  .filter((i) => i.defaultQty !== null)
                  .map((i) => ({ ...i, qty: i.defaultQty ?? i.qty, unitPrice: i.defaultUnitPrice ?? i.unitPrice })),
              }))
            }
          />
          {saved?.summary ? (
            <SmallButton
              label={saved.summary.installAt ? 'See on calendar' : 'Schedule installation'}
              onPress={() => router.push({ pathname: '/internal/calendar', params: { job: String(saved.summary!.id) } })}
            />
          ) : null}
          {draft.quoteId ? (
            <SmallButton label={`Quote #${draft.quoteId}`} onPress={() => router.push({ pathname: '/internal/quote', params: { id: String(draft.quoteId) } })} />
          ) : null}
          {saved?.summary ? <SmallButton label={confirmDelete ? 'Confirm delete' : 'Delete job'} onPress={remove} /> : null}
        </View>
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
          {saved?.summary
            ? `Saved ${manilaTime(saved.summary.updatedAt)} by ${saved.summary.updatedBy}${unsaved ? ' · unsaved changes' : ''}`
            : 'Not saved yet'}
        </ThemedText>
        {saveError ? <MessageList title="Could not save" tone="warn" items={[saveError]} /> : null}
      </Card>

      <MessageList title="Check these" tone="warn" items={derived.warnings} />

      <ProjectPicker
        projects={projects}
        value={draft.projectId}
        quoteName={quote?.customer ?? null}
        onChange={(projectId) => update((d) => ({ ...d, projectId }))}
      />

      {categories.map((category) => {
        const group = derived.groups.find((g) => g.category === category);
        if (!group) return null;
        return (
          <Panel key={category} title={category} right={<ThemedText type="data" style={{ fontSize: 13 }}>{peso(group.total)}</ThemedText>}>
            {group.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onChange={(patch) => setItem(item.id, patch)}
                onRemove={() => update((d) => ({ ...d, items: d.items.filter((i) => i.id !== item.id) }))}
              />
            ))}
            <View style={{ alignSelf: 'flex-start' }}>
              <SmallButton label="+ Add item" onPress={() => addItem(category)} />
            </View>
          </Panel>
        );
      })}

      <Card>
        <ThemedText type="eyebrow" themeColor="textMuted">
          Another category
        </ThemedText>
        <View style={styles.actions}>
          <TextInput
            value={newCategory}
            onChangeText={setNewCategory}
            placeholder="e.g. Scaffolding"
            placeholderTextColor={t.textMuted}
            style={[styles.text, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background, flexBasis: 220 }]}
          />
          <SmallButton
            label="Add"
            onPress={() => {
              const name = newCategory.trim();
              if (!name) return;
              addItem(name);
              setNewCategory('');
            }}
          />
        </View>
        <KeyValue label="Job total" value={peso(derived.total)} total />
      </Card>

      <Panel title="Specs the warnings check" right={<SmallButton label={showSpecs ? 'Hide' : 'Show'} onPress={() => setShowSpecs((v) => !v)} />}>
        {showSpecs ? (
          <View style={styles.specs}>
            {SETTING_FIELDS.map((f) => (
              <SettingInput
                key={f.key}
                label={f.label}
                unit={f.unit}
                value={draft.settings[f.key]}
                onChange={(n) => update((d) => ({ ...d, settings: { ...d.settings, [f.key]: n } }))}
              />
            ))}
          </View>
        ) : (
          <ThemedText type="small" themeColor="textMuted">
            {draft.settings.inverterMaxPanels} panels per inverter · strings of {draft.settings.panelsPerString} · DC/AC up to{' '}
            {draft.settings.maxDcAcRatio}
          </ThemedText>
        )}
      </Panel>
    </InternalPage>
  );
}

/* ---------------- pieces ---------------- */

/** A number box that keeps what's being typed ("1.") until it parses, and follows outside resets. */
function NumberCell({ value, onChange, label, width }: { value: number; onChange: (n: number) => void; label: string; width: number }) {
  const t = useTheme();
  const [text, setText] = useState(String(Number(value.toFixed(2))));
  // A value changed from outside (a reset) rewrites the text; typing that parses to it doesn't.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (toNumber(text) !== value) setText(String(Number(value.toFixed(2))));
  }
  return (
    <TextInput
      value={text}
      onChangeText={(s) => {
        setText(s);
        const n = toNumber(s);
        if (s.trim() !== '' && Number.isFinite(n) && n >= 0) onChange(n);
      }}
      keyboardType="decimal-pad"
      inputMode="decimal"
      accessibilityLabel={label}
      style={[styles.num, { width, color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }]}
    />
  );
}

function SettingInput({ label, unit, value, onChange }: { label: string; unit: string; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <NumberInput
      label={label}
      unit={unit}
      value={text}
      changed={false}
      onChange={(s) => {
        setText(s);
        const n = toNumber(s);
        if (s.trim() !== '' && Number.isFinite(n) && n >= 0) onChange(n);
      }}
    />
  );
}

function ItemRow({ item, onChange, onRemove }: { item: JobItem; onChange: (patch: Partial<JobItem>) => void; onRemove: () => void }) {
  const t = useTheme();
  const custom = item.defaultQty === null;
  const edited = !custom && (item.qty !== item.defaultQty || item.unitPrice !== item.defaultUnitPrice);
  return (
    <View style={[styles.item, { borderBottomColor: t.line }]}>
      <View style={styles.itemName}>
        {custom ? (
          <TextInput
            value={item.name}
            onChangeText={(name) => onChange({ name })}
            placeholder="Item name"
            placeholderTextColor={t.textMuted}
            style={[styles.text, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }]}
          />
        ) : (
          <ThemedText type="small">{item.name}</ThemedText>
        )}
        {edited ? (
          <ThemedText type="data" style={{ fontSize: 11, color: t.accentWarm }}>
            Quote: {num(item.defaultQty ?? 0, item.defaultQty! % 1 ? 1 : 0)} × {peso(item.defaultUnitPrice ?? 0)}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.itemNums}>
        <NumberCell value={item.qty} onChange={(qty) => onChange({ qty })} label={`${item.name} quantity`} width={64} />
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12, minWidth: 28 }}>
          {item.unit || '×'}
        </ThemedText>
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
          ₱
        </ThemedText>
        <NumberCell value={item.unitPrice} onChange={(unitPrice) => onChange({ unitPrice })} label={`${item.name} unit price`} width={96} />
        <ThemedText type="data" style={[styles.lineTotal, { fontSize: 13 }]}>
          {peso(itemTotal(item))}
        </ThemedText>
        {/* Same width with or without a button, so the figures line up down the list. */}
        <View style={styles.rowAction}>
          {edited ? <SmallButton label="Reset" onPress={() => onChange({ qty: item.defaultQty!, unitPrice: item.defaultUnitPrice! })} /> : null}
          {custom ? <SmallButton label="Remove" onPress={onRemove} /> : null}
        </View>
      </View>
    </View>
  );
}

/** Which customer pipeline the job belongs to. */
function ProjectPicker({
  projects,
  value,
  quoteName,
  onChange,
}: {
  projects: Project[];
  value: number | null;
  quoteName: string | null;
  onChange: (id: number | null) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = projects.find((p) => p.id === value);
  const q = query.trim().toLowerCase();
  const shown = projects
    .filter((p) => !q || p.customer.toLowerCase().includes(q) || p.address.toLowerCase().includes(q))
    .slice(0, 8);

  const label = current
    ? `${current.customer}${current.address ? ` · ${current.address}` : ''}`
    : value === null
      ? `New project${quoteName ? ` named “${quoteName}”` : ''}`
      : `Project #${value}`;

  return (
    <Panel title="Project" right={<SmallButton label={open ? 'Done' : 'Change'} onPress={() => setOpen((v) => !v)} />}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
        Link the job to the survey request it came from, so the calendar shows it as one project.
      </ThemedText>
      {open ? (
        <View style={{ gap: Spacing.two }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by customer or address"
            placeholderTextColor={t.textMuted}
            autoFocus
            style={[styles.text, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }]}
          />
          {quoteName !== null ? (
            <PickRow selected={value === null} onPress={() => onChange(null)} title={`New project named “${quoteName}”`} />
          ) : null}
          {shown.map((p) => (
            <PickRow
              key={p.id}
              selected={p.id === value}
              onPress={() => onChange(p.id)}
              title={p.customer}
              sub={[p.address, p.source === 'booking' ? 'survey request' : null].filter(Boolean).join(' · ')}
              projectId={p.id}
            />
          ))}
        </View>
      ) : null}
    </Panel>
  );
}

function PickRow({ selected, onPress, title, sub, projectId }: { selected: boolean; onPress: () => void; title: string; sub?: string; projectId?: number }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.pick,
        { borderColor: selected ? t.accent : t.line, backgroundColor: selected ? t.backgroundSelected : t.backgroundElement },
        pressed && { opacity: 0.7 },
      ]}>
      {projectId !== undefined ? <JobBadge kind="survey" projectId={projectId} customer={title} size={20} /> : null}
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {sub ? (
          <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
            {sub}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  choice: { flexGrow: 1, flexBasis: 260, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.three, gap: Spacing.one },
  summaryTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  item: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: 1,
    paddingVertical: Spacing.two,
  },
  itemName: { flexGrow: 1, flexBasis: 220, gap: 2 },
  itemNums: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  num: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one + 2, fontSize: 14, textAlign: 'right' },
  lineTotal: { minWidth: 90, textAlign: 'right' },
  rowAction: { width: 84, alignItems: 'flex-end' },
  text: { flexGrow: 1, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one + 2, fontSize: 14 },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  pick: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.two },
});
