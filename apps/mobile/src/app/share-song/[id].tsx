import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { Banner, Button, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useT } from '@/lib/settings';
import { ensureSharedSong } from '@/lib/sharing';

export default function SharedSongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(undefined);
    ensureSharedSong(db, id).then(() => {
      if (active) router.replace({ pathname: '/song/[id]', params: { id } });
    }).catch((e) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [db, id, router, attempt]);
  return <Screen>
    <Stack.Screen options={{ title: t('Поширена пісня') }} />
    {error ? <>
      <Banner text={error} kind="warn" />
      <Button title={t('Спробувати ще раз')} onPress={() => setAttempt((value) => value + 1)} />
    </> : <ActivityIndicator accessibilityLabel={t('Завантаження…')} />}
  </Screen>;
}
