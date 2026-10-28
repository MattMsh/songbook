import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { draftChanged, localCalendarDate, parseLocalCalendarDate } from '@/lib/draft-values';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import type { AlbumPlan } from '@songbook/shared';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { confirmDeleteAlbum, promptRenameAlbum } from '@/components/album-actions';
import { AlbumSongs } from '@/components/album-songs';
import { Banner, Button, Field, Row, Screen, T } from '@/components/ui';
import { saveAlbumPlan, setAlbumOrder, toggleAlbumSong } from '@/lib/albums';
import { albumSongs, getAlbum, getAlbumPlan, useRevision, type SongListItem } from '@/lib/db';
import { useT, useTheme } from '@/lib/settings';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const albumId = Number(id);
  const db = useSQLiteContext();
  const router = useRouter();
  const revision = useRevision();
  const { colors } = useTheme();
  const t = useT();
  const [name, setName] = useState('');
  const [songs, setSongs] = useState<SongListItem[]>([]);
  const [plan, setPlan] = useState<AlbumPlan>({});
  const [draft, setDraft] = useState<AlbumPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date | null>(null);
  const confirmDiscard = useUnsavedChanges(draftChanged(draft, plan) || pickerDate !== null, saving);

  useEffect(() => {
    let active = true;
    (async () => {
      const album = await getAlbum(db, albumId);
      if (!active) return;
      if (!album) { setMissing(true); setLoaded(true); return; }
      const [songs, plan] = await Promise.all([albumSongs(db, albumId), getAlbumPlan(db, albumId)]);
      if (!active) return;
      setName(album.name);
      setSongs(songs);
      setPlan(plan);
      setMissing(false);
      setLoaded(true);
    })().catch(() => { if (active) { setError(true); setLoaded(true); } });
    return () => { active = false; };
  }, [db, albumId, revision]);

  const album = { id: albumId, name };
  const reorder = async (next: SongListItem[]) => {
    setSongs(next);
    try { await setAlbumOrder(db, albumId, next.map((s) => s.id)); }
    catch { setError(true); setSongs(await albumSongs(db, albumId)); }
  };
  const removeSong = async (songId: string) => {
    try { await toggleAlbumSong(db, albumId, songId); }
    catch { setError(true); }
  };
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(false);
    try {
      await saveAlbumPlan(db, albumId, draft);
      setDraft(null);
      setPickerDate(null);
    } catch { setError(true); }
    finally { setSaving(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={process.env.EXPO_OS === 'ios' ? 'ellipsis' : {
          // Android native menus require an image source rather than an SF Symbol.
          uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAALUlEQVR4nGNgGAWjYBQMT/CflvL/kTDV5f9jwdSUp70PkBXRUn4UjIJRQG0AANGIJtoLATDeAAAAAElFTkSuQmCC',
        }} accessibilityLabel={t('Дії з альбомом')}>
          <Stack.Toolbar.MenuAction icon="square.and.arrow.up" disabled={!loaded || missing || !songs.length} onPress={() =>
            router.push({ pathname: '/song-tools', params: { album: id } })}>
            {t('Поширення та PDF')}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="pencil" onPress={() => promptRenameAlbum(db, album)}>
            {t('Перейменувати')}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => confirmDeleteAlbum(db, album, () => router.back())}>
            {t('Видалити альбом')}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {draft ? (
        <Screen>
          <T>{t('План служіння')}</T>
          <T muted>{t('Дата служіння')}</T>
          <Row wrap>
            <Button kind="secondary" title={draft.serviceDate || t('Обрати дату')} label={t('Обрати дату служіння')}
              disabled={saving} onPress={() => setPickerDate(parseLocalCalendarDate(draft.serviceDate ?? '') ?? new Date())} />
            {!!draft.serviceDate && <Button kind="ghost" title={t('Очистити дату')} disabled={saving}
              onPress={() => { setDraft({ ...draft, serviceDate: '' }); setPickerDate(null); }} />}
          </Row>
          {pickerDate && <View accessibilityLabel={t('Дата служіння')} style={{ gap: 8 }}>
            <DateTimePicker value={pickerDate} mode="date" disabled={saving}
              onDismiss={() => setPickerDate(null)}
              positiveButton={{ label: t('Готово') }} negativeButton={{ label: t('Скасувати') }}
              onValueChange={(_, date) => {
                if (process.env.EXPO_OS === 'android') { setDraft({ ...draft, serviceDate: localCalendarDate(date) }); setPickerDate(null); }
                else setPickerDate(date);
              }} />
            {process.env.EXPO_OS !== 'android' && <Row wrap>
              <Button title={t('Готово')} disabled={saving} onPress={() => { setDraft({ ...draft, serviceDate: localCalendarDate(pickerDate) }); setPickerDate(null); }} />
              <Button kind="secondary" title={t('Скасувати')} disabled={saving} onPress={() => setPickerDate(null)} />
            </Row>}
          </View>}
          <T muted>{t('Ведучий')}</T>
          <Field value={draft.leader ?? ''} onChangeText={(leader) => setDraft({ ...draft, leader })}
            editable={!saving} accessibilityLabel={t('Ведучий')} maxLength={200} />
          <T muted>{t('Примітки до служіння')}</T>
          <Field value={draft.notes ?? ''} onChangeText={(notes) => setDraft({ ...draft, notes })}
            editable={!saving} accessibilityLabel={t('Примітки до служіння')} multiline maxLength={10000} style={{ minHeight: 100 }} />
          {error && <Banner kind="warn" text={t('Не вдалося зберегти план. Перевірте дату та значення й повторіть.')} />}
          <Row wrap>
            <Button title={t('Зберегти')} disabled={saving || pickerDate !== null} onPress={save} />
            <Button title={t('Скасувати')} kind="secondary" disabled={saving} onPress={() => confirmDiscard(() => { setDraft(null); setPickerDate(null); setError(false); })} />
          </Row>
        </Screen>
      ) : (
        <>
          {error && <Banner kind="warn" text={t('Не вдалося завантажити або зберегти план. Спробуйте ще раз.')} />}
          {!loaded ? <T muted style={{ padding: 16 }}>{t('Завантаження…')}</T> : missing ? (
            <T muted style={{ padding: 16 }}>{t('Альбом не знайдено')}</T>
          ) : (
            <>
              <View style={{ padding: 16, gap: 8 }}>
                {(plan.serviceDate || plan.leader) && <T selectable>{[plan.serviceDate, plan.leader].filter(Boolean).join(' · ')}</T>}
                {plan.notes && <T selectable numberOfLines={3}>{plan.notes}</T>}
                <Button kind="secondary" title={t('План служіння')} onPress={() => {
                  setError(false);
                  setDraft({ serviceDate: plan.serviceDate ?? '', leader: plan.leader ?? '', notes: plan.notes ?? '' });
                }} />
              </View>
              {songs.length > 0 ? (
                <AlbumSongs songs={songs}
                  onOpen={(songId) => router.push({ pathname: '/song/[id]', params: { id: songId, album: id } })}
                  onReorder={reorder} onRemove={removeSong} />
              ) : (
                <T muted style={{ textAlign: 'center', padding: 32 }}>{t('Додайте пісні кнопкою «+» на екрані пісні.')}</T>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}
