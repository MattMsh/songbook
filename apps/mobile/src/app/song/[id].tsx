import { chordContext, keyChoices, lyricsText, mod12, parseChordPro, shiftBetween } from '@songbook/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChordSheet } from '@/components/chord-sheet';
import { Metronome } from '@/components/metronome';
import { Banner, Button, Card, Chip, Icon, Row, T } from '@/components/ui';
import { albumSongs, getOverride, getSong, saveOverride, useRevision, type Override, type SongRow } from '@/lib/db';
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
  const [keyPicker, setKeyPicker] = useState(false);
  const [speed, setSpeed] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);

  useEffect(() => {
    (async () => {
      setSong(await getSong(db, id));
      setOv(await getOverride(db, id));
      setAlbumIds(album ? (await albumSongs(db, Number(album))).map((s) => s.id) : []);
    })();
  }, [db, id, album, revision]);

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

  if (song === undefined) return null;
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
  const transpose = ov?.transpose ?? 0;
  const songCapo = meta.capo ?? 0;
  const capo = songCapo + (ov?.capo ?? 0);
  const ctx = chordContext({ key: meta.key, chords: parsed.chords, notation: meta.notation, display, transpose, capo, songCapo });
  const setTools = ({ transpose, capo }: { transpose?: number; capo?: number }) =>
    saveOverride(db, id, song.version, capo === undefined ? { transpose } : { capo: capo - songCapo });
  const hasLyrics = !!lyricsText(parsed);
  // A chords-only arrangement would be empty in reading mode.
  const showChords = musician || !hasLyrics;

  const pos = albumIds.indexOf(id);
  const goAlbum = (i: number) => router.replace({ pathname: '/song/[id]', params: { id: albumIds[i], album: album! } });
  const font = (d: number) => update({ fontSize: Math.min(40, Math.max(12, settings.fontSize + d)) });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: `${song.number ?? ''} ${song.title}`.trim(),
          headerRight: () => (
            <Row gap={16}>
              {musician && hasLyrics && (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: settings.showLyrics }}
                  accessibilityLabel={t('Показувати текст')}
                  onPress={() => update({ showLyrics: !settings.showLyrics })}>
                  <Icon name="lyrics" size={22} color={settings.showLyrics ? colors.accent : colors.muted} />
                  {!settings.showLyrics && <View style={[styles.strike, { backgroundColor: colors.muted }]} />}
                </Pressable>
              )}
              <Pressable accessibilityLabel={t('Додати в альбом')} onPress={() => router.push(`/add-to-album?songId=${id}`)}>
                <Icon name="addToAlbum" size={24} color={colors.accent} />
              </Pressable>
            </Row>
          ),
        }}
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
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
                meta.tempo && `${meta.tempo} BPM`,
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
              <Row>
                <T style={styles.label}>{t('Бій')}</T>
                <T style={{ fontSize: 20, letterSpacing: 2 }}>{meta.rhythm}</T>
              </Row>
            )}
            <Metronome key={song.id} bpm={meta.tempo} time={meta.time} accents={meta.accents} />
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
          fontSize={settings.fontSize}
        />
        {musician && (
          <Button kind="secondary" icon="edit" title={t('Редагувати')} onPress={() => router.push(`/edit/${id}`)} />
        )}
      </ScrollView>
      <View style={[styles.bar, { borderColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
        {/* Album navigation gets its own row: full-size buttons do not fit next to the reading tools. */}
        {pos >= 0 && (
          <Row gap={16} style={{ justifyContent: 'center' }}>
            <Button kind="secondary" icon="back" label={t('Попередня пісня')} disabled={pos === 0} onPress={() => goAlbum(pos - 1)} />
            <T muted style={{ minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
              {pos + 1}/{albumIds.length}
            </T>
            <Button kind="secondary" icon="forward" label={t('Наступна пісня')} disabled={pos === albumIds.length - 1} onPress={() => goAlbum(pos + 1)} />
          </Row>
        )}
        <Row>
          <Button kind="secondary" title="A−" onPress={() => font(-2)} />
          <Button kind="secondary" title="A+" onPress={() => font(2)} />
          <View style={{ flex: 1 }} />
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  label: { width: 44, fontWeight: '600' },
  strike: { position: 'absolute', left: -2, right: -2, top: 10, height: 2, transform: [{ rotate: '-45deg' }] },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  bar: { gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
