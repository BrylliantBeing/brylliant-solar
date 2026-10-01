import { createContext, use, useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';

/**
 * Staff sign-in for /internal, backed by the PHP session in public/api/auth.php.
 * The server is the gate: this context only mirrors what it says, and every
 * internal API must call require_staff() itself.
 *
 * Relative on web so the cookie stays first-party; absolute on native.
 */
const ENDPOINT =
  Platform.OS === 'web' ? '/api/auth.php' : 'https://solar.brylletan.com/api/auth.php';

export type StaffUser = { username: string; name: string };

type Status =
  | 'loading'
  | 'signedOut'
  | 'signedIn'
  /** Dev only: the Metro server has no PHP, so the endpoint isn't there. */
  | 'noServer';

type StaffSession = {
  status: Status;
  user: StaffUser | null;
  signIn: (username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Dev builds only — stripped from production, where __DEV__ is false. */
  continueWithoutServer: () => void;
};

const StaffContext = createContext<StaffSession | null>(null);

export function useStaffSession() {
  const value = use(StaffContext);
  if (!value) throw new Error('useStaffSession must be used inside <StaffSessionProvider>');
  return value;
}

type AuthReply = { ok: boolean; user?: StaffUser; error?: string };

/** null when the reply isn't JSON from auth.php, i.e. the endpoint isn't deployed here. */
async function call(init?: RequestInit): Promise<{ status: number; body: AuthReply } | null> {
  const res = await fetch(ENDPOINT, { credentials: 'include', ...init });
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
  return { status: res.status, body: (await res.json()) as AuthReply };
}

export function StaffSessionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<StaffUser | null>(null);

  useEffect(() => {
    let live = true;
    call()
      .then((r) => {
        if (!live) return;
        if (r === null) {
          setStatus(__DEV__ ? 'noServer' : 'signedOut');
        } else if (r.body.ok && r.body.user) {
          setUser(r.body.user);
          setStatus('signedIn');
        } else {
          setStatus('signedOut');
        }
      })
      .catch(() => live && setStatus(__DEV__ ? 'noServer' : 'signedOut'));
    return () => {
      live = false;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    try {
      const r = await call({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password }),
      });
      if (r === null) return 'The sign-in service is not reachable.';
      if (!r.body.ok || !r.body.user) return r.body.error ?? 'Sign-in failed.';
      setUser(r.body.user);
      setStatus('signedIn');
      return null;
    } catch {
      return 'Could not reach the server. Check your connection.';
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await call({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
    } finally {
      setUser(null);
      setStatus('signedOut');
    }
  }, []);

  const continueWithoutServer = useCallback(() => {
    if (!__DEV__) return;
    setUser({ username: 'dev', name: 'Local dev' });
    setStatus('signedIn');
  }, []);

  return (
    <StaffContext.Provider value={{ status, user, signIn, signOut, continueWithoutServer }}>
      {children}
    </StaffContext.Provider>
  );
}
