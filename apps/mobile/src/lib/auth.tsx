import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import type { AuthResult, User } from '@songbook/shared';
import { api, ApiError, setApiToken } from './api';

const TOKEN_KEY = 'session_token';
const USER_KEY = 'cached_user';

interface AuthState {
  user: User | null;
  ready: boolean;
  /** Starts a magic-link login; returns the dev code when the server runs in dev mode. */
  startMagic: (email: string) => Promise<string | undefined>;
  verifyMagic: (email: string, proof: { code: string } | { token: string }) => Promise<void>;
  signInWith: (provider: 'apple' | 'google', idToken: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

function cachedUser(): User | null {
  try {
    return JSON.parse(Storage.getItemSync(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // The cached user keeps the profile and role working offline.
  const [user, setUser] = useState<User | null>(cachedUser);
  const [ready, setReady] = useState(false);

  const store = (u: User | null) => {
    setUser(u);
    if (u) Storage.setItemSync(USER_KEY, JSON.stringify(u));
    else Storage.removeItemSync(USER_KEY);
  };

  const clear = async () => {
    setApiToken(null);
    store(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  };

  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      setApiToken(token);
      setReady(true);
      if (!token) return store(null);
      try {
        store((await api<{ user: User }>('/me')).user);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await clear();
      }
    })();
  }, []);

  const finish = async (r: AuthResult) => {
    await SecureStore.setItemAsync(TOKEN_KEY, r.token);
    setApiToken(r.token);
    store(r.user);
  };

  const value: AuthState = {
    user,
    ready,
    startMagic: async (email) =>
      (await api<{ devCode?: string }>('/auth/magic/start', { body: { email } })).devCode,
    verifyMagic: async (email, proof) => finish(await api<AuthResult>('/auth/magic/verify', { body: { email, ...proof } })),
    signInWith: async (provider, idToken, name) =>
      finish(await api<AuthResult>(`/auth/${provider}`, { body: { idToken, name } })),
    logout: async () => {
      await api('/auth/logout', { body: {} }).catch(() => {});
      await clear();
    },
  };
  return <Ctx value={value}>{children}</Ctx>;
}

export function useAuth() {
  const ctx = use(Ctx);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
