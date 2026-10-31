import { calculateDesign, DESIGN_DEFAULTS, type DesignResult } from '@calculator/pvDesign';
import { JINKO_725 } from '@calculator/pvDesignData';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { DesignResults } from '@/components/internal/design/design-results';
import { LayoutEditor } from '@/components/internal/design/layout-editor';
import { SiteMap } from '@/components/internal/design/site-map';
import type { DesignLayout } from '@/components/internal/design/strings';
import { InternalPage } from '@/components/internal/internal-page';
import { MessageList, Panel, SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/kit';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { applyDesignToJob } from '@/lib/design-bom';
import { savingsFromBill, savingsFromQuote } from '@/lib/design-savings';
import { siteCenter } from '@/lib/design-geo';
import {
  getDesign,
  saveDesign,
  type DesignDoc,
  type DesignProject,
  type DesignSite,
  type LoadCircuit,
  type PlanSet,
} from '@/lib/designs-api';
import { getJob, saveJob } from '@/lib/jobs-api';
import { loadPipeline, type Project, type ProjectJob } from '@/lib/projects-api';
import { useYields } from '@/lib/pvgis';
import { priceDesign, type PriceOverrides } from '@/lib/price-list';
import { loadPrices } from '@/lib/prices-api';
import { getQuote, manilaTime, type QuoteInputs } from '@/lib/quotes-api';

type Step = 'site' | 'layout' | 'results' | 'plan';
const STEPS: { step: Step; label: string }[] = [
  { step: 'site', label: '1 · Site' },
  { step: 'layout', label: '2 · Layout' },
  { step: 'results', label: '3 · Wires & materials' },
  { step: 'plan', label: '4 · Plan set' },
];

const EMPTY_LAYOUT: DesignLayout = {
  panels: [],
  inverters: [],
  meter: null,
  panelboard: null,
  floors: 1,
  floorHeightM: 3,
  strings: [],
};

/** A design being edited: the site stays empty until the rectangle is drawn. */
type Doc = Omit<DesignDoc, 'site'> & { site: DesignSite | null };

function newDoc(project: DesignProject): Doc {
  return {
    site: null,
    layout: EMPTY_LAYOUT,
    inputs: {
      settings: {},
      overrides: {},
      patterns: {},
      plan: {
        title: '',
        ownerName: project.customer,
        location: project.address,
        designer: '',
        engineer: '',
        engineerLicense: '',
        loads: [],
      },
    },
  };
}

/** /internal/design?project=4 — the PV design for one project. Without a project, a list to pick from. */
export default function DesignPage() {
  const params = useLocalSearchParams<{ project?: string }>();
  const projectId = Number(params.project) || 0;
  return projectId ? <Designer projectId={projectId} /> : <ProjectPicker />;
}

function ProjectPicker() {
  const t = useTheme();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadPipeline()
      .then((p) => setProjects(p.projects.filter((x) => x.status === 'active')))
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <InternalPage eyebrow="Design" title="Design a system" lede="Pick the project to lay out on the satellite map.">
      {error ? <MessageList title="Could not load projects" items={[error]} tone="warn" /> : null}
      {!projects && !error ? <ActivityIndicator color={t.accent} /> : null}
      <Card>
        {projects?.map((p) => (
          <Link key={p.id} href={{ pathname: '/internal/design', params: { project: String(p.id) } }} asChild>
            {/* Link's Slot rejects style arrays, so flatten first. */}
            <Pressable style={StyleSheet.flatten([styles.pick, { borderBottomColor: t.line }])}>
              <ThemedText type="smallBold">{p.customer}</ThemedText>
              <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
                {p.address || 'No address'}
              </ThemedText>
            </Pressable>
          </Link>
        ))}
        {projects && !projects.length ? (
          <ThemedText type="small" themeColor="textMuted">
            No active projects.
          </ThemedText>
        ) : null}
      </Card>
    </InternalPage>
  );
}

function Designer({ projectId }: { projectId: number }) {
  const t = useTheme();
  const [project, setProject] = useState<DesignProject | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobs, setJobs] = useState<ProjectJob[]>([]);
  const [snapshot, setSnapshot] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('site');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: 'warn' | 'note'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** For the price and the bill: the price list, the project's monthly bill, and its quote's consumption */
  const [prices, setPrices] = useState<PriceOverrides | null>(null);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const [monthlyBill, setMonthlyBill] = useState<number | null>(null);
  const [quoteSrc, setQuoteSrc] = useState<{ id: number; inputs: QuoteInputs } | null>(null);

  useEffect(() => {
    let live = true;
    getDesign(projectId)
      .then(({ project: p, design }) => {
        if (!live) return;
        setProject(p);
        const d: Doc = design ? { site: design.site, layout: design.layout, inputs: design.inputs } : newDoc(p);
        setDoc(d);
        setJobId(design?.jobId ?? null);
        setSnapshot(JSON.stringify(d));
        setSavedAt(design?.updatedAt ?? null);
        setStep(design?.site ? 'layout' : 'site');
      })
      .catch((e: Error) => live && setLoadError(e.message));
    loadPipeline()
      .then((p) => {
        if (!live) return;
        setJobs(p.jobs.filter((j) => j.projectId === projectId));
        setMonthlyBill(p.projects.find((x) => x.id === projectId)?.monthlyBill ?? null);
      })
      .catch(() => {});
    loadPrices()
      .then((r) => live && setPrices(r.prices))
      .catch((e: Error) => {
        if (!live) return;
        setPrices({});
        setPricesError(`${e.message} Using the default prices.`);
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  // The quote whose hourly consumption the bill is simulated from: the linked job's, else any job's.
  const quoteId = jobs.find((j) => j.id === jobId)?.quoteId ?? jobs.find((j) => j.quoteId)?.quoteId ?? null;
  useEffect(() => {
    if (!quoteId) return;
    let live = true;
    getQuote(quoteId)
      .then((q) => live && setQuoteSrc({ id: q.id, inputs: q.inputs }))
      .catch(() => live && setQuoteSrc(null));
    return () => {
      live = false;
    };
  }, [quoteId]);

  const sunData = useYields(doc?.site ? siteCenter(doc.site) : null, doc?.layout.roofs, {
    tiltDeg: doc?.inputs.settings.referenceTiltDeg ?? DESIGN_DEFAULTS.referenceTiltDeg,
    azimuthDeg: doc?.inputs.settings.referenceAzimuthDeg ?? DESIGN_DEFAULTS.referenceAzimuthDeg,
  });
  const result: DesignResult | null = useMemo(
    () =>
      doc
        ? calculateDesign({
            panel: JINKO_725,
            layout: doc.layout,
            strings: doc.layout.strings,
            settings: doc.inputs.settings,
            overrides: doc.inputs.overrides,
            yields: sunData.yields,
          })
        : null,
    [doc, sunData.yields],
  );

  const price = useMemo(() => (result ? priceDesign(result, prices ?? {}) : null), [result, prices]);
  // The bill simulation is a year of hourly steps, so it reruns only when something it depends on changes,
  // not on every drag.
  const savingsKey = result
    ? [result.panels, result.inverters.length, result.acKw, result.sun?.monthlyKwh.join(','), quoteSrc?.id, monthlyBill].join('|')
    : '';
  const savings = useMemo(
    () =>
      !result
        ? null
        : quoteSrc && quoteSrc.id === quoteId
          ? savingsFromQuote(quoteSrc.inputs, quoteSrc.id, result)
          : monthlyBill
            ? savingsFromBill(monthlyBill, result)
            : { error: 'No saved quote or monthly bill on this project, so the bill reduction can’t be worked out.' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savingsKey],
  );

  if (loadError) {
    return (
      <InternalPage eyebrow="Design" title="Design">
        <MessageList title="Could not open the design" items={[loadError]} tone="warn" />
      </InternalPage>
    );
  }
  if (!doc || !project || !result) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  const dirty = JSON.stringify(doc) !== snapshot;
  // Updaters, not values: one editor action can change the layout and the inputs together, and each
  // change must build on the other rather than on this render's doc.
  const set = (patch: Partial<Doc>) => setDoc((d) => d && { ...d, ...patch });
  const setInputs = (patch: Partial<Doc['inputs']>) => setDoc((d) => d && { ...d, inputs: { ...d.inputs, ...patch } });
  const setPlan = (patch: Partial<PlanSet>) =>
    setDoc((d) => d && { ...d, inputs: { ...d.inputs, plan: { ...d.inputs.plan, ...patch } } });

  async function save(): Promise<boolean> {
    if (!doc?.site || !result) {
      setStatus({ tone: 'warn', text: 'Draw the site rectangle before saving.' });
      return false;
    }
    setBusy(true);
    setStatus(null);
    try {
      const at = await saveDesign({ projectId, jobId, site: doc.site, layout: doc.layout, inputs: doc.inputs, result });
      setSnapshot(JSON.stringify(doc));
      setSavedAt(at);
      return true;
    } catch (e) {
      setStatus({ tone: 'warn', text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function applyToJob(id: number) {
    if (!result) return;
    setBusy(true);
    setStatus(null);
    try {
      const job = await getJob(id);
      const { items, unpriced } = applyDesignToJob(job.items, result.bom, prices ?? {});
      await saveJob({
        id: job.id,
        projectId: job.projectId,
        quoteId: job.quoteId,
        systemType: job.systemType,
        items,
        settings: job.settings,
      });
      setJobId(id);
      setStatus({
        tone: 'note',
        text: `Job #${id} now has the design's ${result.bom.length} material lines.${unpriced ? ` ${unpriced} are new at ₱0; price them on the job.` : ''}`,
      });
    } catch (e) {
      setStatus({ tone: 'warn', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    if (dirty && !(await save())) return;
    router.push({ pathname: '/internal/design-print', params: { project: String(projectId) } });
  }

  return (
    <InternalPage eyebrow="Design" title={project.customer} lede={project.address || undefined}>
      <View style={styles.bar}>
        <View style={styles.row}>
          {STEPS.map((s) => {
            const disabled = s.step !== 'site' && !doc.site;
            return (
              <Pressable
                key={s.step}
                disabled={disabled}
                onPress={() => setStep(s.step)}
                style={[
                  styles.step,
                  {
                    borderColor: step === s.step ? t.accent : t.lineStrong,
                    backgroundColor: step === s.step ? t.backgroundSelected : t.background,
                    opacity: disabled ? 0.4 : 1,
                  },
                ]}>
                <ThemedText type="small" themeColor={step === s.step ? 'text' : 'textSecondary'}>
                  {s.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.row}>
          <ThemedText type="small" themeColor={result.warnings.length ? 'accentWarm' : 'textMuted'}>
            {result.panels} panels · {result.dcKw} kWp · {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}
          </ThemedText>
          {price ? (
            <ThemedText type="smallBold">
              {`₱${Math.round(price.total).toLocaleString('en-PH')}${price.unpriced.length ? '*' : ''}`}
              {savings && !('error' in savings) ? ` · bill −${Math.round(savings.reductionPct)}%` : ''}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textMuted">
            {dirty ? 'Unsaved changes' : savedAt ? `Saved ${manilaTime(savedAt)}` : 'Not saved'}
          </ThemedText>
          <SmallButton label={busy ? 'Saving…' : 'Save'} onPress={save} strong />
          <SmallButton label="Print drawings" onPress={print} />
        </View>
      </View>
      {status ? (
        <MessageList title={status.tone === 'warn' ? 'Problem' : 'Done'} items={[status.text]} tone={status.tone} />
      ) : null}

      {step === 'site' ? (
        <Card>
          <SiteMap
            site={doc.site}
            address={project.address}
            onChange={(site) => {
              set({ site });
              setStep('layout');
            }}
          />
        </Card>
      ) : null}

      {step === 'layout' && doc.site ? (
        <Card>
          <LayoutEditor
            site={doc.site}
            layout={doc.layout}
            panel={JINKO_725}
            patterns={doc.inputs.patterns ?? {}}
            onChange={(layout) => set({ layout })}
            onPatternsChange={(patterns) => setInputs({ patterns })}
            onSiteChange={(site) => set({ site })}
          />
          <MessageList title="Check these" items={result.warnings} tone="warn" />
        </Card>
      ) : null}

      {step === 'results' ? (
        <>
          <DesignResults
            result={result}
            settings={doc.inputs.settings}
            overrides={doc.inputs.overrides}
            onSettings={(settings) => setInputs({ settings })}
            onOverrides={(overrides) => setInputs({ overrides })}
            sunData={sunData}
            price={price}
            savings={savings}
            pricesNote={pricesError}
          />
          <Panel title="Apply to a job">
            {jobs.length ? (
              <View style={styles.row}>
                {jobs.map((j) => (
                  <SmallButton
                    key={j.id}
                    label={`Job #${j.id} · ${j.panels} panels${j.id === jobId ? ' (linked)' : ''}`}
                    onPress={() => applyToJob(j.id)}
                  />
                ))}
              </View>
            ) : (
              <ThemedText type="small" themeColor="textMuted">
                This project has no job yet. Start one from a saved quote, then apply the design to it.
              </ThemedText>
            )}
            <ThemedText type="small" themeColor="textMuted">
              Replaces the quote&apos;s rails-per-panel and PV-cable lines with the itemised list, and sets the panel and inverter
              counts. Prices already on the job are kept.
            </ThemedText>
          </Panel>
        </>
      ) : null}

      {step === 'plan' ? <PlanForm plan={doc.inputs.plan} dcKw={result.dcKw} onChange={setPlan} /> : null}
    </InternalPage>
  );
}

function PlanForm({ plan, dcKw, onChange }: { plan: PlanSet; dcKw: number; onChange: (p: Partial<PlanSet>) => void }) {
  const t = useTheme();
  const input = [styles.input, { borderColor: t.lineStrong, color: t.text, backgroundColor: t.background }];
  const text = (label: string, key: keyof Omit<PlanSet, 'loads'>, placeholder = '') => (
    <View style={{ gap: 2, flexGrow: 1, minWidth: 240 }}>
      <ThemedText type="eyebrow" themeColor="textMuted" style={{ fontSize: 10 }}>
        {label}
      </ThemedText>
      <TextInput
        value={plan[key]}
        placeholder={placeholder}
        placeholderTextColor={t.textMuted}
        onChangeText={(v) => onChange({ [key]: v })}
        style={input}
      />
    </View>
  );
  const setLoad = (i: number, patch: Partial<LoadCircuit>) =>
    onChange({ loads: plan.loads.map((l, k) => (k === i ? { ...l, ...patch } : l)) });

  return (
    <>
      <Panel title="Title block">
        <View style={styles.row}>
          {text('Project title', 'title', `${dcKw.toFixed(2)}KWP GRID-TIE SOLAR PV ROOFTOP SYSTEM WITH NET METERING`)}
          {text('Owner', 'ownerName')}
          {text('Location', 'location')}
          {text('Prepared by', 'designer')}
          {text('Electrical engineer (PEE/REE)', 'engineer')}
          {text('PRC license no.', 'engineerLicense')}
        </View>
      </Panel>
      <Panel
        title="Schedule of loads"
        right={
          <SmallButton
            label="Add circuit"
            onPress={() =>
              onChange({ loads: [...plan.loads, { description: '', va: 0, breakerA: 20, wire: '2-3.5mm², 1-2.0mm² (G)' }] })
            }
          />
        }>
        <ThemedText type="small" themeColor="textMuted">
          The house&apos;s existing circuits, from the survey. They fill sheet 2&apos;s load schedule and riser diagram.
        </ThemedText>
        {plan.loads.map((l, i) => (
          <View key={i} style={styles.row}>
            <ThemedText type="data" style={{ width: 24 }}>
              {i + 1}
            </ThemedText>
            <TextInput
              value={l.description}
              placeholder="Description"
              placeholderTextColor={t.textMuted}
              onChangeText={(v) => setLoad(i, { description: v })}
              style={[input, { flexGrow: 1, minWidth: 180 }]}
            />
            <TextInput
              value={l.va ? String(l.va) : ''}
              placeholder="VA"
              placeholderTextColor={t.textMuted}
              onChangeText={(v) => setLoad(i, { va: Number(v) || 0 })}
              style={[input, { width: 80 }]}
            />
            <TextInput
              value={String(l.breakerA)}
              placeholder="AT"
              placeholderTextColor={t.textMuted}
              onChangeText={(v) => setLoad(i, { breakerA: Number(v) || 0 })}
              style={[input, { width: 64 }]}
            />
            <TextInput
              value={l.wire}
              placeholder="Wire"
              placeholderTextColor={t.textMuted}
              onChangeText={(v) => setLoad(i, { wire: v })}
              style={[input, { width: 200 }]}
            />
            <SmallButton label="Remove" onPress={() => onChange({ loads: plan.loads.filter((_, k) => k !== i) })} />
          </View>
        ))}
      </Panel>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  step: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  pick: { paddingVertical: Spacing.two, borderBottomWidth: 1, gap: 2 },
  input: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, paddingVertical: 6 },
});
