import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise component contracts without loading native modules in Node.
function load(file: string, dependencies: Record<string, unknown>): any {
  const source = readFileSync(resolve('src', file), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  new Function('require', 'exports', outputText)((name: string) => {
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name in dependencies) return dependencies[name];
    throw new Error('Unexpected native dependency: ' + name);
  }, exports);
  return exports;
}
function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function hooks() {
  const state: any[] = [];
  const effects: (() => void)[] = [];
  let cursor = 0;
  return {
    react: { ...React,
      useState: (initial: any) => {
        const i = cursor++;
        if (!(i in state)) state[i] = initial;
        return [state[i], (value: any) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }];
      },
      useEffect: (effect: () => void) => { effects.push(effect); },
      useCallback: (callback: unknown) => callback,
    },
    render: (component: () => any) => { cursor = 0; return component(); },
    effects,
  };
}
const translate = (text: string, params: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? key));
const settings = { mode: 'reader', notation: 'auto', language: 'uk', theme: 'system' };
const update = vi.fn();
const colors = { bg: 'white', text: 'black', muted: 'gray', accent: 'blue', fill: 'gray', onFill: 'black', danger: 'red', onDanger: 'white', onAccent: 'white', del: 'pink', card: 'white' };
const theme = { useTheme: () => ({ colors, dark: false }), useT: () => translate, useSettings: () => ({ settings, update }) };
const alerts: any[][] = [];
const native = { Platform: { OS: 'ios' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 }, Alert: { alert: (...args: any[]) => alerts.push(args) } };
const fieldGroup = Object.assign(() => null, { Section: 'Section' });
const expoUI = { FieldGroup: fieldGroup, Host: 'Host', ListItem: 'NativeListItem', RNHostView: 'RNHostView' };
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true };
class ApiError extends Error { constructor(public code: string) { super(code); } }
let ui: any;
beforeEach(() => {
  vi.clearAllMocks(); alerts.length = 0; native.Platform.OS = 'ios';
  ui = load('components/ui.tsx', { 'expo-symbols': { SymbolView: 'SymbolView' }, 'react-native': native, '@/lib/settings': theme });
});
afterEach(() => vi.unstubAllEnvs());

function setupProfile(pending = 0, recovery: boolean | Error = false) {
  const h = hooks();
  const logout = vi.fn(async (_options?: { discardPending?: boolean; expectedUserId?: string }) => {});
  const count = vi.fn(async () => pending);
  const sync = { syncing: false, error: null, lastSyncAt: Date.UTC(2026, 9, 28, 12) };
  const auth: { user: { id: string; name: string; email: string; role: string } | null; ready: boolean; logout: typeof logout } = { user: { id: 'a', name: 'Name', email: 'a@example.com', role: 'musician' }, ready: true, logout };
  const component = load('app/(tabs)/(profile)/profile.tsx', {
    react: h.react, 'react-native': native, '@expo/ui': expoUI, 'expo-router': { useRouter: () => router, useFocusEffect: (effect: () => void) => h.effects.push(effect) },
    'expo-sqlite': { useSQLiteContext: () => ({}) }, '@/components/ui': ui, '@/lib/settings': theme,
    '@/lib/account-deletion': { pendingAccountDeletion: async () => {
      if (recovery instanceof Error) throw recovery;
      return recovery ? { userId: 'old-account', token: 'private-bearer' } : null;
    } },
    '@/lib/auth': { useAuth: () => auth }, '@/lib/db': { useRevision: () => 1, getPendingSharedAlbumCount: count },
    '@/lib/api': { ApiError, errorMessage: (e: unknown) => String(e) }, '@/lib/sync': { useSyncStatus: () => sync, syncNow: vi.fn() },
  }).default;
  return { render: () => h.render(component), logout, count, auth, h };
}

describe('shared accessible controls', () => {
  it.each(['ios', 'android'])('preserves %s minimum targets for small, icon-only and chip controls', (platform) => {
    native.Platform.OS = platform;
    const controls = load('components/ui.tsx', { 'expo-symbols': { SymbolView: 'SymbolView' }, 'react-native': native, '@/lib/settings': theme });
    const minimum = platform === 'android' ? 48 : 44;
    for (const control of [controls.Button({ small: true, icon: 'add', label: 'Add', onPress: vi.fn() }), controls.Button({ small: true, title: 'Long action', onPress: vi.fn() }), controls.Chip({ label: 'Long choice', onPress: vi.fn() })]) {
      const style = Object.assign({}, ...control.props.style({ pressed: false }).filter(Boolean));
      expect(style.minWidth).toBe(minimum); expect(style.minHeight).toBe(minimum);
      expect(style.maxWidth).toBe('100%'); expect(style.flexShrink).toBe(1);
    }
  });
  it('prefers descriptive labels and exposes busy state and warning announcements', () => {
    const button = ui.Button({ title: 'A+', label: 'Increase text', busy: true, onPress: vi.fn() });
    expect(button.props.accessibilityLabel).toBe('Increase text');
    expect(button.props.accessibilityState).toEqual({ busy: true, disabled: true });
    expect(button.props.disabled).toBe(true);
    const label = nodes(button).find((node) => node.type === 'Text');
    expect(label.props.style.flexShrink).toBe(1);
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.maxFontSizeMultiplier).toBeUndefined();
    expect(ui.H({ children: 'Heading' }).props.accessibilityRole).toBe('header');
    const banner = ui.Banner({ text: 'Failed', kind: 'warn' });
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLiveRegion).toBe('assertive');
  });
});

describe('profile safety and scalable choices', () => {
  it('puts account first, links deletion and diagnostics, and does not grant admin from local mode', () => {
    const p = setupProfile();
    const tree = p.render();
    expect(nodes(tree).find((node) => node.type === 'Section').props.title).toBe('Акаунт');
    const rows = nodes(tree).filter((node) => node.type === 'NativeListItem');
    for (const [label, path] of [['Видалити акаунт', '/delete-account'], ['Діагностика', '/diagnostics']]) {
      rows.find((node) => node.props.children === label).props.onPress();
      expect(router.push).toHaveBeenCalledWith(path);
    }
    expect(rows.some((node) => node.props.children === 'Користувачі')).toBe(false);
    const choice = nodes(tree).find((node) => typeof node.type === 'function' && node.type.name === 'Choice');
    const radios = nodes(choice.type(choice.props)).filter((node) => node.type === 'Pressable');
    expect(radios[0].props.accessibilityRole).toBe('radio');
    expect(radios[0].props.accessibilityState.checked).toBe(true);
    radios[1].props.onPress();
    expect(update).toHaveBeenCalledWith({ mode: 'musician' });
    expect(nodes(p.render()).filter((node) => node.type === 'NativeListItem').some((node) => node.props.children === 'Користувачі')).toBe(false);
  });
  it('exposes signed-out deletion recovery without displaying old credentials or identity', async () => {
    const p = setupProfile(0, true);
    p.auth.user = null;
    p.render(); p.h.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(nodes(p.render()).find((node) => node.type === 'NativeListItem' && node.props.children === 'Завершити видалення акаунта')).toBeDefined());
    const tree = p.render();
    expect(JSON.stringify(tree)).not.toContain('private-bearer');
    expect(JSON.stringify(tree)).not.toContain('old-account');
    nodes(tree).find((node) => node.type === 'NativeListItem' && node.props.children === 'Завершити видалення акаунта').props.onPress();
    expect(router.push).toHaveBeenCalledWith('/delete-account');
  });
  it('surfaces a deletion recovery storage failure', async () => {
    const p = setupProfile(0, new Error('private-bearer from malformed storage'));
    p.render(); p.h.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(nodes(p.render()).find((node) => node.type === ui.Banner)?.props.text).toContain('Не вдалося перевірити незавершене видалення акаунта.'));
    expect(JSON.stringify(p.render())).not.toContain('private-bearer');
  });
  it('keeps pending edits until the explicit destructive logout action', async () => {
    const p = setupProfile(2);
    nodes(p.render()).find((node) => node.type === ui.Button && node.props.title === 'Вийти').props.onPress();
    await vi.waitFor(() => expect(alerts).toHaveLength(1));
    expect(p.logout).not.toHaveBeenCalled();
    expect(alerts[0][2][0].style).toBe('cancel');
    alerts[0][2][1].onPress();
    await vi.waitFor(() => expect(p.logout).toHaveBeenCalledWith({ discardPending: true, expectedUserId: 'a' }));
  });
  it('handles a pending-edit race from logout and preserves a failed account operation', async () => {
    const p = setupProfile();
    p.logout.mockRejectedValueOnce(new ApiError('pending_shared_changes'));
    nodes(p.render()).find((node) => node.type === ui.Button && node.props.title === 'Вийти').props.onPress();
    await vi.waitFor(() => expect(alerts).toHaveLength(1));
    p.logout.mockRejectedValueOnce(new Error('disk failure'));
    alerts[0][2][1].onPress();
    await vi.waitFor(() => expect(nodes(p.render()).find((node) => node.type === ui.Banner)?.props.text).toContain('disk failure'));
    expect(p.auth.user?.id).toBe('a');
  });
});

function setupLogin(methods = { email: true, apple: false, google: false }, params: Record<string, string> = {}, nativeAppleAvailable = false) {
  const h = hooks();
  const startMagic = vi.fn(async (_email: string) => undefined as string | undefined);
  const verifyMagic = vi.fn(async (_email: string, _proof: unknown) => {});
  const api = vi.fn(async () => methods);
  const signInWith = vi.fn(async () => {});
  const component = load('app/login.tsx', {
    react: h.react, 'expo-apple-authentication': {
      isAvailableAsync: async () => nativeAppleAvailable,
      AppleAuthenticationButton: 'AppleButton', AppleAuthenticationButtonType: { SIGN_IN: 1 },
      AppleAuthenticationButtonStyle: { WHITE: 1, BLACK: 2 }, AppleAuthenticationScope: { FULL_NAME: 1, EMAIL: 2 },
      signInAsync: async () => ({ identityToken: 'apple-token', fullName: null }),
    },
    'expo-router': { useRouter: () => router, useLocalSearchParams: () => params },
    '@/components/ui': ui, '@/lib/settings': theme,
    '@/lib/api': { api, errorMessage: (e: unknown) => String(e) },
    '@/lib/auth': { useAuth: () => ({ startMagic, verifyMagic, signInWith }) },
  }).default;
  const render = () => h.render(component);
  return { render, h, api, startMagic, verifyMagic, signInWith };
}

describe('diagnostics resync confirmation', () => {
  it('runs safe resync only after the named action and reports unexpected errors', async () => {
    const h = hooks();
    const resyncNow = vi.fn(async () => { throw new Error('disk failure'); });
    const component = load('app/diagnostics.tsx', {
      react: h.react, 'react-native': native, '@expo/ui': expoUI,
      'expo-router': { Stack: { Screen: 'StackScreen' } }, 'expo-sqlite': { useSQLiteContext: () => ({}) },
      '@/components/ui': ui, '@/lib/settings': theme,
      '@/lib/api': { API_URL: 'https://example.test', errorMessage: (e: unknown) => String(e) },
      '@/lib/db': { searchEngine: () => 'FTS5' }, '@/lib/sync': { useSyncStatus: () => ({ syncing: false, error: null }), resyncNow },
    }).default;
    const render = () => h.render(component);
    nodes(render()).find((node) => node.type === 'NativeListItem').props.onPress();
    expect(resyncNow).not.toHaveBeenCalled();
    expect(alerts[0][2][0].style).toBe('cancel');
    expect(alerts[0][2][1].text).toBe('Завантажити пісні заново');
    alerts[0][2][1].onPress();
    await vi.waitFor(() => expect(nodes(render()).find((node) => node.type === ui.Banner)?.props.text).toContain('disk failure'));
    expect(resyncNow).toHaveBeenCalledTimes(1);
  });
});

describe('honest login availability', () => {
  it('does not send email when disabled and never renders a Google button', async () => {
    const l = setupLogin({ email: false, apple: false, google: true });
    l.render(); l.h.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(nodes(l.render()).some((node) => node.type === ui.T && node.props.children === 'Вхід через email зараз недоступний.')).toBe(true));
    const button = nodes(l.render()).find((node) => node.type === ui.Button && node.props.title === 'Надіслати код');
    expect(button.props.disabled).toBe(true);
    button.props.onPress();
    expect(l.startMagic).not.toHaveBeenCalled();
    expect(nodes(l.render()).some((node) => String(node.props?.title).includes('Google'))).toBe(false);
  });
  it('retains named email/code drafts and shows failures without navigating', async () => {
    const l = setupLogin();
    l.render(); l.h.effects.forEach((effect) => effect());
    nodes(l.render()).find((node) => node.type === ui.Field && node.props.accessibilityLabel === 'Електронна пошта').props.onChangeText('a@example.com');
    await vi.waitFor(() => expect(nodes(l.render()).find((node) => node.type === ui.Button && node.props.title === 'Надіслати код').props.disabled).toBe(false));
    nodes(l.render()).find((node) => node.type === ui.Button && node.props.title === 'Надіслати код').props.onPress();
    await vi.waitFor(() => expect(nodes(l.render()).find((node) => node.type === ui.Field && node.props.accessibilityLabel === 'Код з листа')).toBeDefined());
    nodes(l.render()).find((node) => node.type === ui.Field && node.props.accessibilityLabel === 'Код з листа').props.onChangeText('654321');
    l.verifyMagic.mockRejectedValueOnce(new Error('expired code'));
    nodes(l.render()).find((node) => node.type === ui.Button && node.props.title === 'Увійти').props.onPress();
    expect(nodes(l.render()).find((node) => node.type === ui.Button && node.props.title === 'Вхід…').props.busy).toBe(true);
    await vi.waitFor(() => expect(nodes(l.render()).find((node) => node.type === ui.Banner)?.props.text).toContain('expired code'));
    const fields = nodes(l.render()).filter((node) => node.type === ui.Field);
    expect(fields.map((node) => node.props.value)).toEqual(['a@example.com', '654321']);
    expect(router.back).not.toHaveBeenCalled();
  });
  it('shows native Apple only when both server and device support it', async () => {
    vi.stubEnv('EXPO_OS', 'ios');
    const l = setupLogin({ email: false, apple: true, google: false }, {}, true);
    l.render(); l.h.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(nodes(l.render()).find((node) => node.type === 'AppleButton')).toBeDefined());
    nodes(l.render()).find((node) => node.type === 'AppleButton').props.onPress();
    await vi.waitFor(() => expect(l.signInWith).toHaveBeenCalledWith('apple', 'apple-token', undefined));
  });
  it('rejects malformed auth availability rather than enabling a provider', async () => {
    const l = setupLogin({ email: 'yes', apple: false, google: false } as any);
    l.render(); l.h.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(nodes(l.render()).find((node) => node.type === ui.Banner)?.props.text).toContain('Сервер повернув невідомі способи входу.'));
    expect(nodes(l.render()).find((node) => node.type === ui.Button && node.props.title === 'Надіслати код').props.disabled).toBe(true);
  });
  it('keeps methods failures visible and retries without enabling unavailable delivery', async () => {
    const l = setupLogin({ email: false, apple: false, google: false });
    l.api.mockRejectedValueOnce(new Error('offline'));
    l.render(); l.h.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(nodes(l.render()).find((node) => node.type === ui.Banner)?.props.text).toContain('offline'));
    nodes(l.render()).find((node) => node.type === ui.Button && node.props.title === 'Повторити').props.onPress();
    l.render(); l.h.effects.at(-2)!();
    await vi.waitFor(() => expect(l.api).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(nodes(l.render()).some((node) => node.type === ui.T && node.props.children === 'Вхід через email зараз недоступний.')).toBe(true));
    expect(l.startMagic).not.toHaveBeenCalled();
  });
  it.each(['/delete-account', '/untrusted'])('only follows the allowlisted return path %s', async (returnTo) => {
    const l = setupLogin(undefined, { email: 'a@example.com', token: 'proof', returnTo });
    l.render(); l.h.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(l.verifyMagic).toHaveBeenCalledWith('a@example.com', { token: 'proof' }));
    await vi.waitFor(() => expect(returnTo === '/delete-account' ? router.replace : router.back).toHaveBeenCalled());
    if (returnTo === '/delete-account') expect(router.replace).toHaveBeenCalledWith('/delete-account');
    else expect(router.replace).not.toHaveBeenCalledWith('/untrusted');
  });
});
