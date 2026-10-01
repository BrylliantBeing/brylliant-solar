import { View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import AppTabs from '@/components/app-tabs';
import { Colors } from '@/constants/theme';

/** The public website: brand bar plus Home / Estimate / Book tabs. */
export default function SiteLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <AppHeader />
      <AppTabs />
    </View>
  );
}
