import { chordContext, effectiveCapo, effectiveSongSettings, keyChoices, lyricsText, mod12, parseChordPro, shiftBetween, type SongSettings } from '@songbook/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChordSheet } from '@/components/chord-sheet';
import { Metronome } from '@/components/metronome';
import { usePersonalSongNotes } from '@/components/song-notes';
import { draftChanged } from '@/lib/draft-values';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { Banner, Button, Card, Chip, Field, Icon, Row, T } from '@/components/ui';
import { albumSongs, getAlbumSongSettings, getOverride, getSong, saveOverride, useRevision, type Override, type SongRow } from '@/lib/db';
import { saveAlbumSongSettings } from '@/lib/albums';
import { useSettings, useT, useTheme } from '@/lib/settings';

const SCROLL_STEP = 12; // px per second per speed level

export default function SongScreen() {
  const { id, album } = useLocalSearchParams<{ id: string; album?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const revision = useRevision();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { settings, update } = useSettings();
  const t = useT();
  useKeepAwake();

  const [song, setSong] = useState<SongRow | null>();
  const [ov, setOv] = useState<Override | null>(null);
  const [albumIds, setAlbumIds] = useState<string[]>([]);
  const [planSettings, setPlanSettings] = useState<SongSettings>({});
  const [planDraft, setPlanDraft] = useState<{ bpm: string; notes: string } | null>(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [loadKey, setLoadKey] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [keyPicker, setKeyPicker] = useState(false);
  const [speed, setSpeed] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const privateNotes = usePersonalSongNotes(id);
  const confirmDiscardPlan = useUnsavedChanges(draftChanged(planDraft, {
    bpm: planSettings.bpm?.toString() ?? '', notes: planSettings.notes ?? '',
  }), planSaving);

  useEffect(() => {
    let active = true;
    (async () => {
      const [nextSong, nextOverride, songs] = await Promise.all([
        getSong(db, id), getOverride(db, id), album ? albumSongs(db, Number(album)) : Promise.resolve([]),
      ]);
      const ids = songs.map((s) => s.id);
      const plan = album && ids.includes(id) ? await getAlbumSongSettings(db, Number(album), id) : {};
      if (!active) return;
      setSong(nextSong);
      setOv(nextOverride);
      setAlbumIds(ids);
      setPlanSettings(plan);
      setLoadKey(id + ':' + (album ?? ''));
      setLoadError(false);
    })().catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [db, id, album, revision]);

  useEffect(() => { setPlanDraft(null); setSpeed(0); }, [id, album]);

  useEffect(() => {
    if (!speed) return;
    let last = Date.now();
    let frame = requestAnimationFrame(function step() {
      const now = Date.now();
      offset.current += (speed * SCROLL_STEP * (now - last)) / 1000;
      last = now;
      scrollRef.current?.scrollTo({ y: offset.current, animated: false });
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [speed]);

  if (loadError) return <Banner kind="warn" text={t('Не вдалося завантажити пісню. Відкрийте її ще раз.')} />;
  if (song === undefined || loadKey !== id + ':' + (album ?? '')) return null;
  if (song === null)
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <T muted>{t('Пісню видалено або ще не синхронізовано')}</T>
      </View>
    );

  const musician = settings.mode === 'musician';
  const { toolsOpen } = settings;
  const parsed = parseChordPro(ov?.chordpro ?? song.chordpro);
  const { meta } = parsed;
  const display = settings.notation === 'auto' ? meta.notation : settings.notation;
  const inAlbum = !!album && albumIds.includes(id);
  const effective = effectiveSongSettings(planSettings, ov ?? undefined, inAlbum);
  const transpose = effective.transpose;
  const songCapo = meta.capo ?? 0;
  const capo = effectiveCapo(songCapo, effective.capo);
  const bpm = effective.bpm ?? meta.tempo;
  const ctx = chordContext({ key: meta.key, chords: parsed.chords, notation: meta.notation, display, transpose, capo, songCapo });
  const setTools = async ({ transpose, capo }: { transpose?: number; capo?: number }) => {
    const patch = capo === undefined ? { transpose } : { capo: capo - songCapo };
    try {
      if (inAlbum) await saveAlbumSongSettings(db, Number(album), id, patch);
      else await saveOverride(db, id, song.version, patch);
    } catch { Alert.alert(t('Не вдалося зберегти налаштування')); }
  };
  const savePlanSong = async () => {
    if (!planDraft || !inAlbum || planSaving) return;
    setPlanSaving(true);
    try {
      await saveAlbumSongSettings(db, Number(album), id, {
        bpm: planDraft.bpm.trim() ? Number(planDraft.bpm) : undefined, notes: planDraft.notes,
      });
      setPlanDraft(null);
    } catch { Alert.alert(t('Не вдалося зберегти план. Перевірте дату та значення й повторіть.')); }
    finally { setPlanSaving(false); }
  };
  const hasLyrics = !!lyricsText(parsed);
  // A chords-only arrangement would be empty in reading mode.
  const showChords = musician || !hasLyrics;

  const pos = albumIds.indexOf(id);
  const goAlbum = (i: number) => router.replace({ pathname: '/song/[id]', params: { id: albumIds[i], album: album! } });
  const font = (d: number) => update({ fontSize: Math.min(40, Math.max(12, settings.fontSize + d)) });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: `${song.number ?? ''} ${song.title}`.trim() }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.View>
            <Row gap={4}>
              {musician && hasLyrics && (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: settings.showLyrics }}
                  accessibilityLabel={t('Показувати текст')}
                  style={styles.headerButton}
                  onPress={() => update({ showLyrics: !settings.showLyrics })}>
                  <Icon name="lyrics" size={22} color={settings.showLyrics ? colors.accent : colors.muted} />
                  {!settings.showLyrics && <View style={[styles.strike, { backgroundColor: colors.muted }]} />}
                </Pressable>
              )}
              <Pressable style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t('Додати в альбом')} onPress={() => router.push(`/add-to-album?songId=${id}`)}>
                <Icon name="addToAlbum" size={24} color={colors.accent} />
              </Pressable>
            </Row>
        </Stack.Toolbar.View>
        <Stack.Toolbar.Menu icon={process.env.EXPO_OS === 'ios' ? 'ellipsis' : {
          // Android native menus require an image source rather than an SF Symbol.
          uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAALUlEQVR4nGNgGAWjYBQMT/CflvL/kTDV5f9jwdSUp70PkBXRUn4UjIJRQG0AANGIJtoLATDeAAAAAElFTkSuQmCC',
        }} accessibilityLabel={t('Дії з піснею')}>
          <Stack.Toolbar.MenuAction icon="note.text" onPress={() =>
            router.push({ pathname: '/song-tools', params: { songId: id, tool: 'notes' } })}>
            {t('Особисті нотатки')}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="play.circle" onPress={() =>
            router.push({ pathname: '/song-tools', params: { songId: id, tool: 'audio' } })}>
            {t('Аудіо для репетиції')}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="square.and.arrow.up" onPress={() =>
            router.push({ pathname: '/song-tools', params: { songId: id, ...(inAlbum ? { album } : {}) } })}>
            {t('Поширення та PDF')}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="square.and.pencil" onPress={() => router.push(`/edit/${id}`)}>
            {t('Редагувати')}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        onScroll={(e) => (offset.current = e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => setSpeed(0)}>
        {musician && (
          <Pressable
            onPress={() => update({ toolsOpen: !toolsOpen })}
            accessibilityRole="switch"
            accessibilityState={{ checked: toolsOpen }}
            accessibilityLabel={t('Інструменти музиканта')}
            style={[styles.toggle, { backgroundColor: colors.card }]}>
            <T muted style={{ flex: 1 }} numberOfLines={1}>
              {[
                ctx.soundingKey && t('Тональність {key}', { key: ctx.soundingKey }),
                bpm && `${bpm} BPM`,
                meta.time,
                capo ? t('капо {capo}', { capo }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </T>
            <T style={{ color: colors.accent, fontWeight: '600' }}>{t(toolsOpen ? 'Сховати' : 'Показати')}</T>
            <Icon name={toolsOpen ? 'collapse' : 'expand'} size={18} color={colors.accent} />
          </Pressable>
        )}
        {musician && toolsOpen && (
          <Card>
            <Row wrap>
              <T style={styles.label}>{t('Тон')}</T>
              <Button small kind="secondary" title="−" onPress={() => setTools({ transpose: shiftBetween(0, transpose - 1) })} />
              <Button small kind="secondary" title={ctx.soundingKey ?? '?'} onPress={() => setKeyPicker(!keyPicker)} />
              <Button small kind="secondary" title="+" onPress={() => setTools({ transpose: shiftBetween(0, transpose + 1) })} />
              {transpose !== 0 && <Button small kind="ghost" title={t('Скинути')} onPress={() => setTools({ transpose: 0 })} />}
            </Row>
            {keyPicker && ctx.baseKey && (
              <Row wrap gap={6}>
                {keyChoices(ctx.baseKey, display).map((k) => (
                  <Chip
                    key={k.root}
                    label={k.name}
                    active={k.root === mod12(ctx.baseKey!.root + transpose)}
                    onPress={() => setTools({ transpose: shiftBetween(ctx.baseKey!.root, k.root) })}
                  />
                ))}
              </Row>
            )}
            <Row wrap>
              <T style={styles.label}>{t('Капо')}</T>
              <Button small kind="secondary" title="−" onPress={() => setTools({ capo: Math.max(0, capo - 1) })} />
              <T style={{ minWidth: 20, textAlign: 'center' }}>{capo}</T>
              <Button small kind="secondary" title="+" onPress={() => setTools({ capo: Math.min(11, capo + 1) })} />
              {capo > 0 && <T muted>{t('акорди як у {key}', { key: ctx.shapeKey ?? '' })}</T>}
              {capo !== songCapo && <Button small kind="ghost" title={t('Як у пісні')} onPress={() => setTools({ capo: songCapo })} />}
            </Row>
            {meta.rhythm && (
              <Row wrap>
                <T style={styles.label}>{t('Бій')}</T>
                <T style={{ fontSize: 20, letterSpacing: 2 }}>{meta.rhythm}</T>
              </Row>
            )}
            <Metronome key={`${song.id}:${album ?? ''}:${bpm ?? ''}`} bpm={bpm} time={meta.time} accents={meta.accents} />
          </Card>
        )}
        {inAlbum && (
          <Card>
            <T>{t('Налаштування лише для цього плану')}</T>
            {planDraft ? (
              <>
                <T muted>{t('Темп, BPM')}</T>
                <Field value={planDraft.bpm} onChangeText={(bpm) => setPlanDraft({ ...planDraft, bpm })}
                  editable={!planSaving} keyboardType="number-pad" maxLength={3} accessibilityLabel={t('Темп, BPM')} placeholder="20–400" />
                <T muted>{t('Примітки до переходу')}</T>
                <Field value={planDraft.notes} onChangeText={(notes) => setPlanDraft({ ...planDraft, notes })}
                  editable={!planSaving} multiline maxLength={5000} accessibilityLabel={t('Примітки до переходу')} />
                <Row wrap>
                  <Button title={t('Зберегти')} onPress={savePlanSong} disabled={planSaving} />
                  <Button title={t('Скасувати')} kind="secondary" onPress={() => confirmDiscardPlan(() => setPlanDraft(null))} disabled={planSaving} />
                </Row>
              </>
            ) : (
              <>
                {planSettings.notes && <T selectable>{planSettings.notes}</T>}
                <Button title={t('Темп і перехід')} kind="secondary" onPress={() =>
                  setPlanDraft({ bpm: planSettings.bpm?.toString() ?? '', notes: planSettings.notes ?? '' })} />
              </>
            )}
            <Button kind="ghost" title={t('Відкрити поза планом')} onPress={() =>
              router.replace({ pathname: '/song/[id]', params: { id } })} />
          </Card>
        )}
        {ov?.chordpro != null && (
          <Banner
            kind={ov.base_version < song.version ? 'warn' : 'info'}
            text={
              ov.base_version < song.version
                ? t('Ваша локальна версія створена до останньої зміни на сервері.')
                : t('Показано вашу локальну версію.')
            }
          />
        )}
        {meta.link && (
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(meta.link!)}>
            <T style={{ color: colors.accent }} numberOfLines={1}>
              {t('Текст пісні: {link}', { link: meta.link.replace(/^https?:\/\/(www\.)?/, '') })}
            </T>
          </Pressable>
        )}
        <ChordSheet
          song={parsed}
          showChords={showChords}
          // Hiding lyrics is a musician tool; in reading mode the text is always shown.
          showLyrics={!musician || settings.showLyrics}
          mapChord={ctx.map}
          capo={capo}
          fontSize={settings.fontSize}
          renderSectionNote={(sectionKey) => {
            const note = privateNotes.notes.find((note) => note.section_key === sectionKey && note.text.trim());
            return note ? <Pressable accessibilityRole="button"
              accessibilityLabel={t('Редагувати приватну нотатку до секції {name}', { name: note.label })}
              onPress={() => router.push({ pathname: '/song-tools', params: { songId: id, tool: 'notes', sectionKey } })}
              style={{ gap: 4, padding: 10, marginVertical: 6, backgroundColor: colors.card, borderLeftWidth: 2, borderColor: colors.accent }}>
              <T muted style={{ fontWeight: '600' }}>{t('Приватна нотатка · Редагувати')}</T>
              <T selectable numberOfLines={3}>{note.text}</T>
            </Pressable> : null;
          }}
        />
        {privateNotes.error && <Banner kind="warn" text={t('Не вдалося завантажити нотатки.')} />}
      </ScrollView>
      <View style={[styles.bar, { borderColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
        {/* Album navigation gets its own row: full-size buttons do not fit next to the reading tools. */}
        {pos >= 0 && (
          <Row wrap gap={16} style={{ justifyContent: 'center' }}>
            <Button kind="secondary" icon="back" label={t('Попередня пісня')} disabled={pos === 0} onPress={() => goAlbum(pos - 1)} />
            <T muted style={{ minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
              {pos + 1}/{albumIds.length}
            </T>
            <Button kind="secondary" icon="forward" label={t('Наступна пісня')} disabled={pos === albumIds.length - 1} onPress={() => goAlbum(pos + 1)} />
          </Row>
        )}
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Row wrap style={{ maxWidth: '100%' }}>
            <Button kind="secondary" title="A−" label={t('Зменшити текст')} onPress={() => font(-2)} />
            <Button kind="secondary" title="A+" label={t('Збільшити текст')} onPress={() => font(2)} />
          </Row>
          <Row wrap style={{ maxWidth: '100%' }}>
          <Button kind="secondary" icon="remove" label={t('Повільніше')} onPress={() => setSpeed(Math.max(0, speed - 1))} />
          <Button
            kind={speed ? 'primary' : 'secondary'}
            icon={speed ? 'pause' : 'down'}
            label={t(speed ? 'Зупинити прокрутку' : 'Автопрокрутка')}
            title={speed ? String(speed) : undefined}
            onPress={() => setSpeed(speed ? 0 : 2)}
          />
          <Button kind="secondary" icon="add" label={t('Швидше')} onPress={() => setSpeed(Math.min(8, speed + 1))} />
          </Row>
        </Row>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  label: { minWidth: 44, fontWeight: '600' },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  strike: { position: 'absolute', width: 26, top: 21, height: 2, transform: [{ rotate: '-45deg' }] },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  bar: { gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
