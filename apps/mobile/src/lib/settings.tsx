import { getLocales } from 'expo-localization';
import { Color } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { createContext, use, useMemo, useState, type ReactNode } from 'react';
import { Appearance, Platform, useColorScheme, type ColorValue } from 'react-native';
import { setLanguage, translate, type Language, type Params } from './i18n';

export interface Settings {
  /** reader: clean lyrics; musician: chords and tools right away. */
  mode: 'reader' | 'musician';
  /** Chord notation for display; `auto` keeps the song's own notation. */
  notation: 'auto' | 'english' | 'german';
  theme: 'system' | 'light' | 'dark';
  language: Language;
  fontSize: number;
  /** Musician tools block on the song screen (transpose, capo, metronome). */
  toolsOpen: boolean;
  /** Musician mode: show lyrics under the chords, or chords only. */
  showLyrics: boolean;
  /** The first-run screen (language and mode) is done. */
  onboarded: boolean;
}

/** The device's primary language if the app has it, else null (then the first-run screen asks). */
export function deviceLanguage(): Language | null {
  // Not Intl: on iOS it reports a language the app bundle supports, not the one the user set.
  const code = getLocales()[0].languageCode;
  return code === 'uk' || code === 'ru' ? code : null;
}

const DEFAULTS: Settings = {
  mode: 'reader',
  notation: 'auto',
  theme: 'system',
  language: deviceLanguage() ?? 'uk',
  fontSize: 18,
  toolsOpen: true,
  showLyrics: true,
  onboarded: false,
};
const KEY = 'settings';

// The override also reaches native views (tab bar, SwiftUI/Compose controls), not only our palette.
const applyTheme = (theme: Settings['theme']) => Appearance.setColorScheme(theme === 'system' ? 'auto' : theme);

function load(): Settings {
  let settings = DEFAULTS;
  try {
    const stored = Storage.getItemSync(KEY);
    // Installs from before the first-run screen already chose their settings.
    settings = { ...DEFAULTS, onboarded: stored !== null, ...JSON.parse(stored ?? '{}') };
  } catch {}
  applyTheme(settings.theme);
  setLanguage(settings.language);
  return settings;
}

const Ctx = createContext<{ settings: Settings; update: (patch: Partial<Settings>) => void } | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load);
  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      if (next.theme !== s.theme) applyTheme(next.theme);
      setLanguage(next.language);
      Storage.setItemSync(KEY, JSON.stringify(next));
      return next;
    });
  return <Ctx value={{ settings, update }}>{children}</Ctx>;
}

export function useSettings() {
  const ctx = use(Ctx);
  if (!ctx) throw new Error('SettingsProvider missing');
  return ctx;
}

/** Translator for components: a new function per language, so memoized UI re-renders when it changes. */
export function useT() {
  const { language } = useSettings().settings;
  return useMemo(() => (key: string, params?: Params) => translate(language, key, params), [language]);
}

const sys = (ios: ColorValue, android: ColorValue, web: string) => Platform.select({ ios, android, default: web })!;

/** System colors resolve on-device and follow light/dark, contrast, and Android wallpaper colors. */
const SYSTEM = {
  bg: sys(Color.ios.systemBackground, Color.android.dynamic.surface, '#FFFFFF'),
  card: sys(Color.ios.secondarySystemBackground, Color.android.dynamic.surfaceContainerHigh, '#F2F2F7'),
  // Translucent fill for gray buttons and chips: stays visible on bg and on cards.
  fill: sys(Color.ios.tertiarySystemFill, Color.android.dynamic.secondaryContainer, '#7676801F'),
  onFill: sys(Color.ios.label, Color.android.dynamic.onSecondaryContainer, '#000000'),
  // List row dividers: stronger than the system separator, which is barely visible in dark mode.
  separator: sys(Color.ios.systemGray3, Color.android.dynamic.outline, '#C7C7CC'),
  border: sys(Color.ios.opaqueSeparator, Color.android.dynamic.outlineVariant, '#C6C6C8'),
  text: sys(Color.ios.label, Color.android.dynamic.onSurface, '#000000'),
  muted: sys(Color.ios.secondaryLabel, Color.android.dynamic.onSurfaceVariant, '#6C6C70'),
  accent: sys(Color.ios.systemBlue, Color.android.dynamic.primary, '#007AFF'),
  onAccent: sys('#FFFFFF', Color.android.dynamic.onPrimary, '#FFFFFF'),
  danger: sys(Color.ios.systemRed, Color.android.dynamic.error, '#FF3B30'),
  onDanger: sys('#FFFFFF', Color.android.dynamic.onError, '#FFFFFF'),
};

/** Song content colors have no system role, so they are fixed pairs tuned for text contrast. */
const CONTENT = {
  light: {
    chord: '#C2410C',
    onChord: '#FFFFFF',
    chorus: '#BE123C',
    bridge: '#6D28D9',
    other: '#0369A1',
    success: '#15803D',
    add: '#DCFCE7',
    del: '#FEE2E2',
  },
  dark: {
    chord: '#FDBA74',
    onChord: '#000000',
    chorus: '#FB7185',
    bridge: '#C4B5FD',
    other: '#7DD3FC',
    success: '#4ADE80',
    add: '#14532D',
    del: '#7F1D1D',
  },
};
const PALETTE = { light: { ...SYSTEM, ...CONTENT.light }, dark: { ...SYSTEM, ...CONTENT.dark } };

export type Colors = typeof PALETTE.light;

/** Calling useColorScheme here also re-renders Android system colors when the theme flips. */
export function useTheme(): { colors: Colors; dark: boolean } {
  const dark = useColorScheme() === 'dark';
  return { colors: dark ? PALETTE.dark : PALETTE.light, dark };
}
