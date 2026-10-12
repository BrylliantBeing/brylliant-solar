import { InternalPage } from '@/components/internal/internal-page';
import { ThemedText } from '@/components/themed-text';

/** The plan set prints from a browser; design-print.web.tsx is the real page. */
export default function DesignPrint() {
  return (
    <InternalPage eyebrow="Design" title="Plan set">
      <ThemedText type="small" themeColor="textSecondary">
        Open this page on a computer to print the drawings.
      </ThemedText>
    </InternalPage>
  );
}
