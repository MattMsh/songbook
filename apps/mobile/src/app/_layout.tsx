import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useStackOptions } from '@/components/ui';
import { Welcome } from '@/components/welcome';
import { AuthProvider, useAuth } from '@/lib/auth';
import { DB_NAME, migrate } from '@/lib/db';
import { SettingsProvider, useSettings, useT, useTheme } from '@/lib/settings';
import { syncNow } from '@/lib/sync';

/** Syncs on start, on return to the foreground, and when the role changes (shared albums depend on it). */
function SyncOnForeground() {
  const db = useSQLiteContext();
  const role = useAuth().user?.role;
  useEffect(() => {
    syncNow(db);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && syncNow(db));
    return () => sub.remove();
  }, [db, role]);
  return null;
}

function Navigation() {
  const { colors, dark } = useTheme();
  const t = useT();
  const { onboarded } = useSettings().settings;
  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider
      value={{ ...base, colors: { ...base.colors, background: colors.bg, card: colors.bg, primary: colors.accent, text: colors.text } }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={useStackOptions()}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add-to-album" options={{ presentation: 'modal', title: t('Додати в альбом') }} />
        <Stack.Screen name="login" options={{ title: t('Вхід') }} />
      </Stack>
      {/* Over the navigator rather than instead of it, so the router and deep links stay mounted. */}
      {!onboarded && (
        <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
          <Welcome />
        </View>
      )}
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SettingsProvider>
      <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
        <AuthProvider>
          <SyncOnForeground />
          <Navigation />
        </AuthProvider>
      </SQLiteProvider>
    </SettingsProvider>
  );
}
