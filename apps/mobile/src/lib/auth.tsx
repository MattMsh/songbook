import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { useSQLiteContext } from 'expo-sqlite';
import { clearAlbumSession, enableAlbumSession } from './albums';
import { discardQuarantinedAlbumDrafts, getPendingSharedAlbumCount, getSharedAlbumOwner, initializeSharedAlbumOwner, restoreSharedAlbumDrafts } from './db';
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthResult, User } from '@songbook/shared';
import { api, ApiError, setApiToken } from './api';
import { clearDeletedAccountPrivateData } from './account-deletion';

const TOKEN_KEY = 'session_token';
const USER_KEY = 'cached_user';

interface AuthState {
  user: User | null;
  ready: boolean;
  /** Starts a magic-link login; returns the dev code when the server runs in dev mode. */
  startMagic: (email: string) => Promise<string | undefined>;
  verifyMagic: (email: string, proof: { code: string } | { token: string }) => Promise<void>;
  signInWith: (provider: 'apple' | 'google', idToken: string, name?: string) => Promise<void>;
  logout: (options?: { discardPending?: boolean; expectedUserId?: string }) => Promise<void>;
  /** Call only after the server confirms account deletion. */
  completeAccountDeletion: (userId: string) => Promise<void>;
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
  const db = useSQLiteContext();
  // The cached user keeps the profile and role working offline.
  const [user, setUser] = useState<User | null>(cachedUser);
  const [ready, setReady] = useState(false);
  const authWork = useRef(Promise.resolve());
  // Credential changes run in request order, including startup verification.
  const enqueue = (work: () => Promise<void>) => {
    const result = authWork.current.then(work);
    authWork.current = result.catch(() => {});
    return result;
  };

  const store = (u: User | null) => {
    setUser(u);
    if (u) Storage.setItemSync(USER_KEY, JSON.stringify(u));
    else Storage.removeItemSync(USER_KEY);
  };

  const clear = async (discardPending = false) => {
    await clearAlbumSession(db, { discardPending });
    setApiToken(null);
    store(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  };

  useEffect(() => {
    void enqueue(async () => {
      await initializeSharedAlbumOwner(db, cachedUser()?.id ?? null);
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      setApiToken(token);
      if (!token) {
        await clear();
        setReady(true);
        return;
      }
      let next: User;
      try {
        next = (await api<{ user: User }>('/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await clear();
        else enableAlbumSession();
        setReady(true);
        return;
      }
      // A storage failure is not an offline response: keep shared writes disabled.
      if (next.id !== await getSharedAlbumOwner(db) || next.role === 'member') await clearAlbumSession(db);
      await restoreSharedAlbumDrafts(db, next.id, next.role !== 'member');
      store(next);
      enableAlbumSession();
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  const finish = async (r: AuthResult) => {
    await clearAlbumSession(db);
    await SecureStore.setItemAsync(TOKEN_KEY, r.token);
    setApiToken(r.token);
    store(r.user);
    await restoreSharedAlbumDrafts(db, r.user.id, r.user.role !== 'member');
    enableAlbumSession();
  };

  const value: AuthState = {
    user,
    ready,
    startMagic: async (email) =>
      (await api<{ devCode?: string }>('/auth/magic/start', { body: { email } })).devCode,
    verifyMagic: (email, proof) => enqueue(async () => finish(await api<AuthResult>('/auth/magic/verify', { body: { email, ...proof } }))),
    signInWith: (provider, idToken, name) =>
      enqueue(async () => finish(await api<AuthResult>(`/auth/${provider}`, { body: { idToken, name } }))),
    logout: (options = {}) => enqueue(async () => {
      const expectedUserId = options.expectedUserId ?? user?.id ?? null;
      if ((cachedUser()?.id ?? null) !== expectedUserId) throw new ApiError(409, 'account_changed');
      if (!options.discardPending && await getPendingSharedAlbumCount(db) > 0)
        throw new ApiError(409, 'pending_shared_changes');
      await api('/auth/logout', { body: {} }).catch(() => {});
      await clear(options.discardPending);
    }),
    completeAccountDeletion: (userId) => enqueue(async () => {
      const currentUserId = cachedUser()?.id;
      if (currentUserId && currentUserId !== userId) throw new ApiError(409, 'account_changed');
      await clearDeletedAccountPrivateData(db, userId);
      await discardQuarantinedAlbumDrafts(db, userId);
      if (currentUserId) await clear(true);
    }),
  };
  return <Ctx value={value}>{children}</Ctx>;
}

export function useAuth() {
  const ctx = use(Ctx);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
