import { getDirective, hasChanges, lineDiff, parseChordPro, splitHeader, type Proposal, type SyncSong } from '@songbook/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { SongBuilder } from '@/components/song-builder';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { ChordSheet } from '@/components/chord-sheet';
import { DiffView } from '@/components/diff-view';
import { MetaForm, withRequiredMeta } from '@/components/meta-form';
import { Banner, Button, Chip, H, Row, T } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getOverride, getSong, saveOverride, type Override, type SongRow } from '@/lib/db';
import { useSettings, useT, useTheme } from '@/lib/settings';
import { syncNow } from '@/lib/sync';

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
  const headerHeight = useHeaderHeight();
  const scroll = useRef<ScrollViewInstance>(null);
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
  const [baseline, setBaseline] = useState(isNew ? TEMPLATE.head + TEMPLATE.body : '');
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [exit, setExit] = useState<'back' | 'all' | null>(null);
  useUnsavedChanges(!exit && text !== baseline, busy);
  useEffect(() => {
    if (exit && !busy) { if (exit === 'all') router.dismissAll(); else router.back(); }
  }, [exit, busy, router]);

  useEffect(() => {
    if (isNew) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const s = await getSong(db, id);
        const o = await getOverride(db, id);
        if (!active) return;
        if (!s) { setLoadError(t('Пісню не знайдено')); return; }
        setSong(s);
        setOv(o);
        load(o?.chordpro ?? s.chordpro);
      } catch (e) { if (active) setLoadError(errorMessage(e)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [db, id, isNew, attempt]);

  function load(src: string) {
    const parts = splitHeader(src);
    setHead(parts.head);
    setBody(parts.body);
    setBaseline(src);
  }

  const parsed = parseChordPro(text);
  const server = song?.chordpro ?? '';
  const diff = lineDiff(server, text);
  const changed = isNew ? text.trim() !== (TEMPLATE.head + TEMPLATE.body).trim() : hasChanges(diff);
  const noTitle = isNew && !getDirective(head, 'title');
  const noText = isNew && !parsed.sections.some(s => s.lines.some(l => l.type === 'lyrics' && l.segments.some(x => x.chord || x.text.trim())));
  const baseVersion = ov?.chordpro != null ? ov.base_version : (song?.version ?? 0);
  const stale = !!song && baseVersion < song.version;
  const goTo = (next: Tab) => { Keyboard.dismiss(); setTab(next); scroll.current?.scrollTo({ y: 0, animated: false }); };

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
      setExit('back');
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
        if (isNew) setExit('back');
        else setBaseline(text);
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
          const latest = await getSong(db, id);
          if (latest) setSong(latest);
          throw new Error(t('Пісню вже змінили на сервері. Оновлено до нової версії — перевірте зміни та збережіть ще раз.'));
        }
        throw e;
      }
      await syncNow(db);
      setExit('back');
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
            setExit('all');
          }),
      },
    ]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerHeight}>
      <Stack.Screen options={{
        title: t(isNew ? 'Нова пісня' : 'Редагування'),
        headerRight: keyboard ? () => <Button small kind="ghost" title={t('Готово')} onPress={Keyboard.dismiss} /> : undefined,
      }} />
      <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}>
        {loading ? <T>{t('Завантаження…')}</T> : loadError ? <>
          <Banner kind="warn" text={loadError} />
          <Button title={t('Спробувати ще раз')} onPress={() => setAttempt(n => n + 1)} />
        </> : <View pointerEvents={busy ? 'none' : 'auto'} style={{ gap: 16 }}>
          <Row wrap gap={6}>
            <Chip label={t('Параметри')} active={tab === 'meta'} onPress={() => goTo('meta')} />
            <Chip label={t('Текст')} active={tab === 'text'} onPress={() => goTo('text')} />
            <Chip label={t('Перегляд')} active={tab === 'preview'} onPress={() => goTo('preview')} />
            {!isNew && <Chip label={t('Зміни')} active={tab === 'diff'} onPress={() => goTo('diff')} />}
          </Row>
          {isNew && <T muted>{t('1. Назва та параметри → 2. Блоки пісні → 3. Перевірка й збереження')}</T>}
          {stale && <Banner kind="warn" text={t('Сервер має новішу версію ({server}), ваші правки — від версії {base}.', { server: song!.version, base: baseVersion })} />}
          {tab === 'meta' && <MetaForm head={head} onChange={setHead} notation={parsed.meta.notation} chords={parsed.chords} />}
          {tab === 'text' && <SongBuilder value={body} onChange={setBody} chords={parsed.chords} german={parsed.meta.notation === 'german'} />}
          {tab === 'preview' && (noText
            ? <Banner text={t('Додайте текст хоча б одного блоку на вкладці «Текст».')} />
            : <View style={{ gap: 12 }}>
                <H>{parsed.meta.title || t('Без назви')}</H>
                <T muted>{[parsed.meta.key, parsed.meta.time, parsed.meta.tempo && `${parsed.meta.tempo} BPM`].filter(Boolean).join(' · ')}</T>
                <ChordSheet song={parsed} showChords mapChord={c => c} fontSize={fontSize} />
              </View>)}
          {tab === 'diff' && (changed ? <DiffView diff={diff} /> : <T muted>{t('Змін відносно сервера немає')}</T>)}
          <View style={{ gap: 12, paddingTop: 16, borderTopWidth: 0.5, borderColor: colors.border }}>
            {isNew && tab === 'meta' ? <Button title={t('Далі: текст пісні')} onPress={() => goTo('text')} />
              : isNew && tab === 'text' ? <Button title={t('Перевірити пісню')} onPress={() => goTo('preview')} />
              : <>
                {noTitle && <Banner kind="warn" text={t('Вкажіть назву пісні на вкладці «Параметри».')} />}
                {user?.role === 'admin' ? <>
                  <Button title={t(isNew ? 'Створити пісню' : 'Зберегти для всіх')} busy={busy}
                    disabled={!changed || noTitle || noText} onPress={saveServer} />
                  <T muted>{t('Пісня стане доступною всім після синхронізації.')}</T>
                </> : user ? <>
                  <Button title={t('Надіслати на розгляд')} busy={busy} disabled={!changed || noTitle || noText} onPress={propose} />
                  <T muted>{t('Адміністратор перевірить пісню перед публікацією.')}</T>
                </> : <Button kind="secondary" title={t('Увійти, щоб запропонувати')} onPress={() => router.push('/login')} />}
                {!isNew && <>
                  <Button kind="secondary" title={t('Зберегти лише на пристрої')} busy={busy} onPress={saveLocal} />
                  {ov?.chordpro != null && <Button kind="ghost" title={t('Скинути локальні зміни')} disabled={busy} onPress={() =>
                    Alert.alert(t('Скинути локальні зміни?'), t('Буде відновлено текст із сервера.'), [
                      { text: t('Скасувати'), style: 'cancel' },
                      { text: t('Скинути'), style: 'destructive', onPress: resetLocal },
                    ])} />}
                  {user?.role === 'admin' && <Button kind="danger" title={t('Видалити пісню')} disabled={busy} onPress={remove} />}
                </>}
              </>}
            {busy && <T accessibilityLiveRegion="polite">{t('Збереження…')}</T>}
          </View>
        </View>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
