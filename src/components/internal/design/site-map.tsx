import { ThemedText } from '@/components/themed-text';
import type { DesignSite } from '@/lib/designs-api';

/** The map editor is web-only; staff design systems on a computer. */
export function SiteMap(_: { site: DesignSite | null; address: string; onChange: (site: DesignSite) => void }) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      Open this page on a computer to find the site on the map.
    </ThemedText>
  );
}
