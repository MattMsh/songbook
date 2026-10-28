import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  token: 'token-a' as string | null,
  cached: JSON.stringify({ id: 'a', role: 'musician', email: 'a@example.com', name: null }) as string | null,
  apiToken: null as string | null,
  pending: 0,
  owner: 'a' as string | null,
}));
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void) => { mock.effects.push(effect); },
}));
vi.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => mock.token),
  setItemAsync: vi.fn(async (_key: string, token: string) => { mock.token = token; }),
  deleteItemAsync: vi.fn(async () => { mock.token = null; }),
}));
vi.mock('expo-sqlite/kv-store', () => ({ default: {
  getItemSync: () => mock.cached,
  setItemSync: (_key: string, value: string) => { mock.cached = value; },
  removeItemSync: () => { mock.cached = null; },
} }));
vi.mock('../src/lib/albums', () => ({
  clearAlbumSession: vi.fn(async () => {}),
  enableAlbumSession: vi.fn(),
}));
vi.mock('../src/lib/account-deletion', () => ({ clearDeletedAccountPrivateData: vi.fn(async () => {}) }));
vi.mock('../src/lib/db', () => ({
  discardQuarantinedAlbumDrafts: vi.fn(async () => {}),
  getPendingSharedAlbumCount: vi.fn(async () => mock.pending),
  getSharedAlbumOwner: vi.fn(async () => mock.owner),
  initializeSharedAlbumOwner: vi.fn(async () => {}),
  restoreSharedAlbumDrafts: vi.fn(async (_db: unknown, id: string) => { mock.owner = id; }),
}));
vi.mock('../src/lib/api', () => ({
  api: vi.fn(), setApiToken: (token: string | null) => { mock.apiToken = token; },
  ApiError: class extends Error { constructor(public status: number, public code: string) { super(code); } },
}));
import { api } from '../src/lib/api';
import { clearAlbumSession, enableAlbumSession } from '../src/lib/albums';
import { clearDeletedAccountPrivateData } from '../src/lib/account-deletion';
import { AuthProvider } from '../src/lib/auth';

const user = (id: string) => ({ id, role: 'musician', email: id + '@example.com', name: null });
beforeEach(() => {
  vi.clearAllMocks();
  mock.effects = [];
  mock.token = 'token-a';
  mock.cached = JSON.stringify(user('a'));
  mock.apiToken = null;
  mock.pending = 0;
  mock.owner = 'a';
});
function mount() {
  const element = AuthProvider({ children: null });
  for (const effect of mock.effects) effect();
  return element.props.value;
}

it('serializes startup verification before logout so a late /me cannot restore the old user', async () => {
  let release!: (value: unknown) => void;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/me') return new Promise((resolve) => { release = resolve; });
    return {} as never;
  });
  const auth = mount();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const logout = auth.logout();
  release({ user: user('a') });
  await logout;
  expect(mock.token).toBeNull();
  expect(mock.apiToken).toBeNull();
  expect(mock.cached).toBeNull();
  expect(clearAlbumSession).toHaveBeenCalled();
});

it('keeps requested login order and prevents older network results from replacing the new account', async () => {
  let release!: (value: unknown) => void;
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === '/me') return { user: user('a') } as never;
    const email = (init!.body as { email: string }).email;
    if (email === 'b@example.com') return new Promise((resolve) => { release = resolve; });
    return { token: 'token-c', user: user('c') } as never;
  });
  const auth = mount();
  const loginB = auth.verifyMagic('b@example.com', { code: 'b' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const loginC = auth.verifyMagic('c@example.com', { code: 'c' });
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/auth/magic/verify')).toHaveLength(1);
  release({ token: 'token-b', user: user('b') });
  await Promise.all([loginB, loginC]);
  expect(mock.token).toBe('token-c');
  expect(mock.apiToken).toBe('token-c');
  expect(JSON.parse(mock.cached!).id).toBe('c');
});

it('does not mistake failed cache clearing for an offline authentication response', async () => {
  vi.mocked(api).mockResolvedValue({ user: user('b') });
  vi.mocked(clearAlbumSession).mockRejectedValueOnce(new Error('disk failure'));
  const auth = mount();
  await auth.logout();
  expect(enableAlbumSession).not.toHaveBeenCalled();
  expect(mock.cached).toBeNull();
});

it('cleans a confirmed deletion without logout or a pending guard', async () => {
  vi.mocked(api).mockResolvedValue({ user: user('a') });
  const auth = mount();
  mock.pending = 2;
  await auth.completeAccountDeletion('a');
  expect(clearDeletedAccountPrivateData).toHaveBeenCalledWith(expect.anything(), 'a');
  expect(clearAlbumSession).toHaveBeenCalledWith(expect.anything(), { discardPending: true });
  expect(api).not.toHaveBeenCalledWith('/auth/logout', expect.anything());
  expect(mock.cached).toBeNull();
});

it('does not clear another account after a delayed deletion response', async () => {
  vi.mocked(api).mockResolvedValue({ user: user('a') });
  const auth = mount();
  await expect(auth.completeAccountDeletion('someone-else')).rejects.toMatchObject({ code: 'account_changed' });
  expect(clearDeletedAccountPrivateData).not.toHaveBeenCalled();
  expect(mock.token).toBe('token-a');
});

it('rejects a stale discard confirmation after a newer account signs in', async () => {
  vi.mocked(api).mockImplementation(async (path) => path === '/me'
    ? { user: user('a') } as never : { token: 'token-b', user: user('b') } as never);
  const auth = mount();
  await auth.verifyMagic('b@example.com', { code: 'b' });
  vi.mocked(clearAlbumSession).mockClear();
  await expect(auth.logout({ discardPending: true })).rejects.toMatchObject({ code: 'account_changed' });
  expect(clearAlbumSession).not.toHaveBeenCalled();
  expect(mock.token).toBe('token-b');
});

it('recovers confirmed deletion while signed out without touching another cache or credentials', async () => {
  mock.token = null;
  mock.cached = null;
  const auth = mount();
  await vi.waitFor(() => expect(clearAlbumSession).toHaveBeenCalled());
  vi.mocked(clearAlbumSession).mockClear();
  await auth.completeAccountDeletion('a');
  expect(clearDeletedAccountPrivateData).toHaveBeenCalledWith(expect.anything(), 'a');
  expect(clearAlbumSession).not.toHaveBeenCalled();
});

it('blocks logout before the server request when pending writes appeared after the UI check', async () => {
  let release!: (value: unknown) => void;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/me') return new Promise((resolve) => { release = resolve; });
    return {} as never;
  });
  const auth = mount();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const logout = auth.logout();
  mock.pending = 1;
  release({ user: user('a') });
  await expect(logout).rejects.toMatchObject({ code: 'pending_shared_changes' });
  expect(api).not.toHaveBeenCalledWith('/auth/logout', expect.anything());
  expect(clearAlbumSession).not.toHaveBeenCalled();
  expect(mock.token).toBe('token-a');
  expect(JSON.parse(mock.cached!).id).toBe('a');
});

it('discards pending changes only when the caller explicitly requests it', async () => {
  vi.mocked(api).mockResolvedValue({ user: user('a') });
  const auth = mount();
  mock.pending = 1;
  await auth.logout({ discardPending: true });
  expect(clearAlbumSession).toHaveBeenCalledWith(expect.anything(), { discardPending: true });
  expect(mock.token).toBeNull();
});

it('quarantines instead of discarding pending drafts on an expired session', async () => {
  const { ApiError } = await import('../src/lib/api');
  vi.mocked(api).mockRejectedValue(new ApiError(401, 'unauthorized'));
  mount();
  mock.pending = 1;
  await vi.waitFor(() => expect(mock.token).toBeNull());
  expect(clearAlbumSession).toHaveBeenCalledWith(expect.anything(), { discardPending: false });
  expect(mock.token).toBeNull();
});

it('does not let a failed login prevent a later logout', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/me') return { user: user('a') } as never;
    if (path === '/auth/magic/verify') throw new Error('invalid_code');
    return {} as never;
  });
  const auth = mount();
  await expect(auth.verifyMagic('b@example.com', { code: 'wrong' })).rejects.toThrow('invalid_code');
  await auth.logout();
  expect(mock.cached).toBeNull();
  expect(mock.token).toBeNull();
});
