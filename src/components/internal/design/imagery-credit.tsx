import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Sits over the bottom of a map. Google requires its logo (16–19 px tall, with
 * clear space round it) and the viewport copyright text; Esri needs its credit line.
 */
export function ImageryCredit({ provider, text }: { provider: 'google' | 'esri'; text: string }) {
  return (
    <View pointerEvents="none" style={styles.bar}>
      {provider === 'google' ? (
        <Image source={require('@/assets/images/google-maps-logo.svg')} style={styles.logo} contentFit="contain" accessibilityLabel="Google Maps" />
      ) : (
        <View />
      )}
      <Text style={styles.text} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 10,
    paddingBottom: 5,
    zIndex: 1000,
  },
  logo: { width: 86, height: 18 },
  text: {
    maxWidth: '70%',
    fontSize: 10,
    lineHeight: 13,
    color: '#222',
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderTopLeftRadius: 3,
  },
});
