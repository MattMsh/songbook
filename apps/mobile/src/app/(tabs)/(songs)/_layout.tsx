import { Stack } from 'expo-router';
import { useStackOptions } from '@/components/ui';
import { useT } from '@/lib/settings';

export default function Layout() {
  const t = useT();
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ title: t('Пісні') }} />
    </Stack>
  );
}
