import { calculateDesign, DESIGN_DEFAULTS } from '@calculator/pvDesign';
import { JINKO_725 } from '@calculator/pvDesignData';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActivityIndicator, View } from 'react-native';

import { PlanSheets, type SheetData } from '@/components/internal/design/plan-sheets';
import { InternalPage } from '@/components/internal/internal-page';
import { MessageList, SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { siteCenter } from '@/lib/design-geo';
import { getDesign } from '@/lib/designs-api';
import { loadYields } from '@/lib/pvgis';

/**
 * The app renders inside #root, a full-height flex box whose body never
 * scrolls, which prints as one clipped page. So the sheets are drawn twice: a
 * preview in the page, and a copy portalled straight into <body> that only
 * shows when printing, one A3 sheet per page.
 */
const PRINT_CSS = `
.design-print-copy { display: none; }
@page { size: A3 landscape; margin: 0; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  #root { display: none !important; }
  .design-print-copy { display: block !important; }
  .design-print-copy .design-sheet { width: 420mm; height: 297mm; page-break-after: always; break-after: page; }
  .design-print-copy .design-sheet:last-child { page-break-after: auto; break-after: auto; }
}
`;

/** /internal/design-print?project=4 — the saved design as the net-metering plan set. */
export default function DesignPrint() {
  const t = useTheme();
  const params = useLocalSearchParams<{ project?: string }>();
  const projectId = Number(params.project) || 0;
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    getDesign(projectId)
      .then(async ({ project, design }) => {
        if (!design) throw new Error('This project has no saved design yet.');
        const doc = { site: design.site, layout: design.layout, inputs: design.inputs };
        // The sheets print without the generation figures if PVGIS is down.
        const c = siteCenter(doc.site);
        const st = doc.inputs.settings;
        const yields = await loadYields(c.lat, c.lng, doc.layout.roofs, {
          tiltDeg: st.referenceTiltDeg ?? DESIGN_DEFAULTS.referenceTiltDeg,
          azimuthDeg: st.referenceAzimuthDeg ?? DESIGN_DEFAULTS.referenceAzimuthDeg,
        })
          .then((r) => r.yields)
          .catch(() => null);
        // Recalculated rather than read back, so the drawings match the current engine.
        const result = calculateDesign({
          panel: JINKO_725,
          layout: doc.layout,
          strings: doc.layout.strings,
          settings: doc.inputs.settings,
          overrides: doc.inputs.overrides,
          yields,
        });
        setData({ project, doc, result });
      })
      .catch((e: Error) => setError(e.message));
  }, [projectId]);

  if (!projectId || error) {
    return (
      <InternalPage eyebrow="Design" title="Plan set">
        <MessageList title="Nothing to print" items={[error ?? 'Open this from a project’s design page.']} tone="warn" />
      </InternalPage>
    );
  }
  if (!data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <InternalPage eyebrow="Plan set" title={data.project.customer} lede="Two A3 landscape sheets. In the print dialog choose A3, landscape, no margins, and turn off headers and footers.">
      <style>{PRINT_CSS}</style>
      <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center' }}>
        <SmallButton label="Print / save as PDF" onPress={() => window.print()} strong />
        <ThemedText type="small" themeColor="textMuted">
          {data.result.warnings.length ? `${data.result.warnings.length} design warnings are listed on sheet 1.` : 'No design warnings.'}
        </ThemedText>
      </View>
      <View style={{ gap: Spacing.three }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PlanSheets data={data} />
        </div>
      </View>
      {/* data only arrives client-side, after the fetch, so document exists here */}
      {typeof document !== 'undefined'
        ? createPortal(
            <div className="design-print-copy">
              <PlanSheets data={data} />
            </div>,
            document.body,
          )
        : null}
    </InternalPage>
  );
}
