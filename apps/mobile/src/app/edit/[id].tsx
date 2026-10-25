import { getDirective, hasChanges, lineDiff, parseChordPro, splitHeader, type Proposal, type SyncSong } from '@songbook/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChordSheet } from '@/components/chord-sheet';
import { DiffView } from '@/components/diff-view';
import { MetaForm, withRequiredMeta } from '@/components/meta-form';
import { Banner, Button, Chip, Field, Row, Screen, T } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getOverride, getSong, saveOverride, type Override, type SongRow } from '@/lib/db';
import { useSettings, useT, useTheme } from '@/lib/settings';
import { syncNow } from '@/lib/sync';

const COMMON = {
  english: ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Am', 'Bm', 'Dm', 'Em', 'F#m', 'C#m', 'Bb', 'D7', 'E7', 'G7', 'A7', 'Csus4', 'Dsus4', 'C/E', 'G/B', 'D/F#'],
  german: ['C', 'D', 'E', 'F', 'G', 'A', 'H', 'Am', 'Hm', 'Dm', 'Em', 'F#m', 'C#m', 'Bb', 'D7', 'E7', 'G7', 'A7', 'Csus4', 'Dsus4', 'C/E', 'G/H', 'D/F#'],
};
const TEMPLATE = splitHeader('{key: C}\n{time: 4/4}\n\n{c: Куплет 1}\n');
type Tab = 'meta' | 'text' | 'preview' | 'diff';

export default function EditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();
  const { fontSize } = useSettings().settings;
  const insets = useSafeAreaInsets();
  // A multiline editor and number pads have no key that closes the keyboard, so the header offers one.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => (show.remove(), hide.remove());
  }, []);
  const t = useT();
  const [song, setSong] = useState<SongRow | null>(null);
  const [ov, setOv] = useState<Override | null>(null);
  // Header directives are edited in the form, the rest in the text field; `head + body` is the song.
  const [head, setHead] = useState(isNew ? TEMPLATE.head : '');
  const [body, setBody] = useState(isNew ? TEMPLATE.body : '');
  const text = head + body;
  // What leaves the editor always has a key and a time signature.
  const final = () => withRequiredMeta(head, parsed.chords, parsed.meta.notation) + body;
  const [tab, setTab] = useState<Tab>(isNew ? 'meta' : 'text');
  const [busy, setBusy] = useState(false);
  // Selection stays uncontrolled (controlled selection breaks the Android cursor); we only track it.
  // iOS keeps the caret at the end before focus and sends no event if a tap leaves it there.
  const selection = useRef({ start: TEMPLATE.body.length, end: TEMPLATE.body.length });

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const s = await getSong(db, id);
      const o = await getOverride(db, id);
      setSong(s);
      setOv(o);
      load(o?.chordpro ?? s?.chordpro ?? '');
    })();
  }, [db, id, isNew]);

  function load(src: string) {
    const parts = splitHeader(src);
    setHead(parts.head);
    setBody(parts.body);
    selection.current = { start: parts.body.length, end: parts.body.length };
  }

  const parsed = parseChordPro(text);
  const server = song?.chordpro ?? '';
  const diff = lineDiff(server, text);
  const changed = isNew ? text.trim() !== (TEMPLATE.head + TEMPLATE.body).trim() : hasChanges(diff);
  const noTitle = isNew && !getDirective(head, 'title');
  const baseVersion = ov?.chordpro != null ? ov.base_version : (song?.version ?? 0);
  const stale = !!song && baseVersion < song.version;
  const notation = parsed.meta.notation;
  const palette = [...new Set([...parsed.chords, ...COMMON[notation]])];

  const insert = (chord: string) => insertText(`[${chord}]`);
  // `|` separates bars, `-` splits a bar between chords: | Am - F | C - G |
  const insertText = (text: string) => {
    let tag = text;
    let { start, end } = selection.current;
    // A caret inside an existing [chord] would split it; insert after the tag instead.
    if (body.lastIndexOf('[', start - 1) > body.lastIndexOf(']', start - 1)) {
      const close = body.indexOf(']', start);
      if (close >= 0) start = end = close + 1;
    }
    if (tag.startsWith('[') && body[start - 1] === '|') tag = ' ' + tag;
    setBody(body.slice(0, start) + tag + body.slice(end));
    selection.current = { start: start + tag.length, end: start + tag.length };
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert(t('Помилка'), errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveLocal = () =>
    run(async () => {
      await saveOverride(db, id, song!.version, { chordpro: hasChanges(diff) ? final() : null });
      router.back();
    });

  const resetLocal = () =>
    run(async () => {
      await saveOverride(db, id, song!.version, { chordpro: null });
      load(server);
    });

  const propose = () => {
    const send = () =>
      run(async () => {
        const chordpro = final();
        const payload = isNew ? { kind: 'new', chordpro } : { kind: 'edit', songId: id, baseVersion, chordpro };
        const r = await api<{ proposal: Proposal; conflict: boolean }>('/proposals', { body: payload });
        Alert.alert(
          t('Надіслано'),
          t(
            r.conflict
              ? 'Пропозицію надіслано, але пісню вже змінили на сервері. Адміністратор побачить різницю.'
              : 'Адміністратор розгляне вашу пропозицію. Статус — у «Мої пропозиції».',
          ),
        );
        if (isNew) router.back();
      });
    if (stale)
      Alert.alert(t('Конфлікт версій'), t('Пісню змінили на сервері після ваших правок. Все одно надіслати?'), [
        { text: t('Скасувати'), style: 'cancel' },
        { text: t('Надіслати'), onPress: send },
      ]);
    else send();
  };

  const saveServer = () =>
    run(async () => {
      try {
        if (isNew) await api<SyncSong>('/songs', { body: { chordpro: final() } });
        else {
          await api<SyncSong>(`/songs/${id}`, { method: 'PUT', body: { chordpro: final(), baseVersion: song!.version } });
          await saveOverride(db, id, song!.version, { chordpro: null });
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'version_conflict') {
          await syncNow(db);
          throw new Error(t('Пісню вже змінили на сервері. Оновлено до нової версії — перевірте зміни та збережіть ще раз.'));
        }
        throw e;
      }
      await syncNow(db);
      router.back();
    });

  const remove = () =>
    Alert.alert(t('Видалити пісню?'), t('Пісня зникне в усіх користувачів.'), [
      { text: t('Скасувати'), style: 'cancel' },
      {
        text: t('Видалити'),
        style: 'destructive',
        onPress: () =>
          run(async () => {
            await api(`/songs/${id}`, { method: 'DELETE' });
            await syncNow(db);
            router.dismissAll();
          }),
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: t(isNew ? 'Нова пісня' : 'Редагування'),
          headerRight: keyboard
            ? () => (
                <Pressable accessibilityRole="button" hitSlop={8} style={{ paddingHorizontal: 8 }} onPress={() => Keyboard.dismiss()}>
                  <T style={{ color: colors.accent, fontSize: 17, fontWeight: '600' }}>{t('Готово')}</T>
                </Pressable>
              )
            : undefined,
        }}
      />
      <View style={styles.tabs}>
        <Row wrap gap={6}>
          <Chip label={t('Параметри')} active={tab === 'meta'} onPress={() => setTab('meta')} />
          <Chip label={t('Текст')} active={tab === 'text'} onPress={() => setTab('text')} />
          <Chip label={t('Перегляд')} active={tab === 'preview'} onPress={() => setTab('preview')} />
          {!isNew && <Chip label={t('Зміни')} active={tab === 'diff'} onPress={() => setTab('diff')} />}
        </Row>
        {stale && <Banner kind="warn" text={t('Сервер має новішу версію ({server}), ваші правки — від версії {base}.', { server: song!.version, base: baseVersion })} />}
      </View>
      {tab === 'text' && (
        <>
          <ScrollView horizontal style={styles.palette} contentContainerStyle={styles.paletteContent} keyboardShouldPersistTaps="always">
            <Chip label="|" onPress={() => insertText(' | ')} />
            <Chip label="-" onPress={() => insertText(' - ')} />
            {palette.map((c) => (
              <Chip key={c} label={c} onPress={() => insert(c)} />
            ))}
          </ScrollView>
          <Field
            multiline
            value={body}
            onChangeText={setBody}
            onSelectionChange={(e) => (selection.current = e.nativeEvent.selection)}
            autoCapitalize="none"
            autoCorrect={false}
            textAlignVertical="top"
            style={styles.editor}
          />
        </>
      )}
      {tab === 'meta' && (
        <Screen>
          <MetaForm head={head} onChange={setHead} notation={parsed.meta.notation} chords={parsed.chords} />
        </Screen>
      )}
      {tab === 'preview' && (
        <Screen>
          <ChordSheet song={parsed} showChords mapChord={(c) => c} fontSize={fontSize} />
        </Screen>
      )}
      {tab === 'diff' && (
        <Screen>{changed ? <DiffView diff={diff} /> : <T muted>{t('Змін відносно сервера немає')}</T>}</Screen>
      )}
      <View style={[styles.actions, { borderColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
        <Row wrap>
          {!isNew && <Button title={t('Зберегти локально')} disabled={busy} onPress={saveLocal} />}
          {!isNew && ov?.chordpro != null && <Button kind="secondary" title={t('Скинути')} disabled={busy} onPress={resetLocal} />}
          {user ? (
            <Button kind="secondary" title={t('Запропонувати')} disabled={busy || !changed || noTitle} onPress={propose} />
          ) : (
            <Button kind="secondary" title={t('Увійти, щоб запропонувати')} onPress={() => router.push('/login')} />
          )}
          {user?.role === 'admin' && (
            <>
              <Button kind="secondary" icon="upload" title={t('На сервер')} disabled={busy || !changed || noTitle} onPress={saveServer} />
              {!isNew && <Button kind="danger" icon="trash" label={t('Видалити')} disabled={busy} onPress={remove} />}
            </>
          )}
        </Row>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { padding: 12, gap: 8 },
  palette: { flexGrow: 0 },
  paletteContent: { paddingHorizontal: 12, gap: 6, paddingBottom: 8 },
  editor: { flex: 1, marginHorizontal: 12, fontFamily: 'monospace', fontSize: 15 },
  actions: { paddingHorizontal: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
