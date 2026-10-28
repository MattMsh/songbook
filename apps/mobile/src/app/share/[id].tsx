import { parseChordPro, type PlanShareSnapshot } from '@songbook/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { Banner, Button, Card, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useT } from '@/lib/settings';
import { fetchPlanShare, importPlanShare } from '@/lib/sharing';

export default function SharedPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const t = useT();
  const [snapshot, setSnapshot] = useState<PlanShareSnapshot>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSnapshot(undefined);
    setError(undefined);
    fetchPlanShare(id).then((result) => { if (active) setSnapshot(result); })
      .catch((e) => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, attempt]);
  const save = async () => {
    if (!snapshot) return;
    setSaving(true);
    setError(undefined);
    try {
      const albumId = await importPlanShare(db, snapshot);
      router.replace({ pathname: '/album/[id]', params: { id: String(albumId) } });
    } catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  };
  return <Screen>
    <Stack.Screen options={{ title: t('Поширений план') }} />
    <Banner text={t('Кожен, хто має посилання, зможе прочитати вміст. Збереження створює окрему офлайн-копію та не замінює ваші альбоми.')} />
    {loading && <ActivityIndicator accessibilityLabel={t('Завантаження…')} />}
    {error && <Banner text={error} kind="warn" />}
    {!loading && !snapshot && <Button title={t('Спробувати ще раз')} onPress={() => setAttempt((value) => value + 1)} />}
    {snapshot && <>
      <Card>
        <T selectable style={{ fontWeight: '700', fontSize: 22 }}>{snapshot.name}</T>
        {snapshot.serviceDate && <T selectable>{snapshot.serviceDate}</T>}
        {snapshot.leader && <T selectable>{t('Ведучий')}: {snapshot.leader}</T>}
        {snapshot.notes && <T selectable>{snapshot.notes}</T>}
        {snapshot.songs.map((song, index) => <T selectable key={song.id}>
          {index + 1}. {parseChordPro(song.chordpro).meta.title || t('Без назви')}
        </T>)}
      </Card>
      <Button title={saving ? t('Збереження…') : t('Зберегти офлайн')} disabled={saving} onPress={() => void save()} />
    </>}
  </Screen>;
}
