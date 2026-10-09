import { Platform } from 'react-native';

/**
 * Where the PHP API lives. Web is same-origin (the site itself, or the dev
 * proxy in scripts/dev-proxy.js). Native builds have no origin, so production
 * uses the live site and dev builds use EXPO_PUBLIC_API_BASE, never production.
 */
const NATIVE_BASE = __DEV__
  ? (process.env.EXPO_PUBLIC_API_BASE ?? 'http://localhost:3000')
  : 'https://brylliant.solar';

export const apiUrl = (path: string) => (Platform.OS === 'web' ? path : NATIVE_BASE + path);
