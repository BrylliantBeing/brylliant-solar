import type { PanelSpec } from '@calculator/pvDesignData';

import type { DesignLayout } from './strings';

import { ThemedText } from '@/components/themed-text';
import type { DesignSite } from '@/lib/designs-api';

/** The layout editor is web-only; staff design systems on a computer. */
export function LayoutEditor(_: {
  site: DesignSite;
  layout: DesignLayout;
  panel: PanelSpec;
  patterns: Record<string, number[]>;
  onChange: (layout: DesignLayout) => void;
  onPatternsChange: (patterns: Record<string, number[]>) => void;
  onSiteChange: (site: DesignSite) => void;
}) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      Open this page on a computer to lay out the panels.
    </ThemedText>
  );
}
