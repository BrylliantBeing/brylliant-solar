import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextType =
  | 'default'
  | 'display'
  | 'title'
  | 'subtitle'
  | 'heading'
  | 'lede'
  | 'small'
  | 'smallBold'
  | 'eyebrow'
  | 'data'
  | 'dataLarge'
  | 'link'
  | 'code';

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  return (
    <Text
      style={[{ color: theme[themeColor ?? 'text'] }, styles[type], style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: { fontSize: 16, lineHeight: 25, fontFamily: Fonts.serif },
  display: { fontSize: 38, lineHeight: 41, fontWeight: '700', letterSpacing: -1.2, fontFamily: Fonts.sans },
  title: { fontSize: 28, lineHeight: 31, fontWeight: '700', letterSpacing: -0.9, fontFamily: Fonts.sans },
  subtitle: { fontSize: 21, lineHeight: 25, fontWeight: '700', letterSpacing: -0.5, fontFamily: Fonts.sans },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3, fontFamily: Fonts.sans },
  lede: { fontSize: 17, lineHeight: 26, fontFamily: Fonts.serif },
  small: { fontSize: 14, lineHeight: 21, fontFamily: Fonts.serif },
  smallBold: { fontSize: 14, lineHeight: 21, fontWeight: '700', fontFamily: Fonts.sans },
  eyebrow: { fontSize: 10, lineHeight: 14, fontWeight: '600', letterSpacing: 1.8, textTransform: 'uppercase', fontFamily: Fonts.mono },
  data: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.mono },
  dataLarge: { fontSize: 24, lineHeight: 28, fontWeight: '600', letterSpacing: -0.6, fontFamily: Fonts.mono },
  link: { fontSize: 14, lineHeight: 21, fontFamily: Fonts.sans, fontWeight: '600' },
  code: { fontSize: 12, fontFamily: Fonts.mono },
});
