import { Host, Slider, Switch } from '@expo/ui';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { personalSongKey } from '@/lib/song-notes';
import { audioFile, importRehearsalAudio, loadAudioAttachments, removeAudioAttachment, validateAudioUrl, validateLoopRange, type AudioAttachment } from '@/lib/rehearsal-audio';
import { useT } from '@/lib/settings';
import { Button, Field, H, Row, T } from './ui';

export function RehearsalAudio({ songId }: { songId: string }) {
  const { user } = useAuth();
  const scopedId = personalSongKey(songId, user?.id ?? null);
  return <ScopedRehearsalAudio key={scopedId} songId={scopedId} />;
}

function ScopedRehearsalAudio({ songId }: { songId: string }) {
  const db = useSQLiteContext();
  const t = useT();
  const [attachments, setAttachments] = useState<AudioAttachment[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [loop, setLoop] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const seeking = useRef(false);
  const player = useAudioPlayer(null, { updateInterval: 50 });
  const status = useAudioPlayerStatus(player);
  const a = start.trim() ? Number(start.replace(',', '.')) : NaN;
  const b = end.trim() ? Number(end.replace(',', '.')) : NaN;
  const validLoop = validateLoopRange(a, b, status.duration);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; operation.current?.abort(); };
  }, []);
  useEffect(() => {
    let active = true;
    setAttachments(null);
    setError('');
    loadAudioAttachments(db, songId).then((rows) => { if (active) setAttachments(rows); })
      .catch(() => { if (active) setError(t('Не вдалося завантажити аудіозаписи.')); });
    return () => { active = false; };
  }, [db, songId, attempt, t]);
  // shortcut: A/B loops use 50 ms status updates; use native loop regions if gapless repetition becomes necessary.
  useEffect(() => {
    if (!loop || !validLoop || seeking.current || !(status.playing || status.didJustFinish)) return;
    if (status.currentTime >= b || status.currentTime < a || status.didJustFinish) {
      seeking.current = true;
      void player.seekTo(a).then(() => { if (alive.current && status.didJustFinish) player.play(); })
        .catch(() => { if (alive.current) { setLoop(false); setError(t('Не вдалося перейти до фрагмента.')); } })
        .finally(() => { seeking.current = false; });
    }
  }, [loop, validLoop, a, b, status.currentTime, status.playing, status.didJustFinish, player, t]);

  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError('');
    try { await work(controller.signal); }
    catch (cause) {
      if (alive.current && !controller.signal.aborted) {
        const code = cause instanceof Error ? cause.message : '';
        setError(t(code === 'size' ? 'Аудіофайл має бути непорожнім і не більшим за 50 МБ.'
          : code === 'format' ? 'Підтримуються лише аудіофайли MP3, M4A, WAV та AAC.'
          : code === 'url' ? 'Вкажіть пряме HTTPS-посилання на MP3, M4A, WAV або AAC без пароля.'
          : 'Не вдалося виконати дію з аудіо. Перевірте файл, мережу та вільне місце.'));
      }
    } finally {
      operation.current = null;
      if (alive.current) setBusy(false);
    }
  };
  const add = async (source: Parameters<typeof importRehearsalAudio>[2], signal: AbortSignal) => {
    const attachment = await importRehearsalAudio(db, songId, source, signal);
    if (alive.current) { setAttachments((rows) => [...(rows ?? []), attachment]); setUrl(''); }
  };
  const pick = () => { void run(async (signal) => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: false, copyToCacheDirectory: true });
    if (!result.canceled && !signal.aborted) await add(result.assets[0], signal);
  }); };
  const download = () => { void run(async (signal) => {
    const source = validateAudioUrl(url);
    await add({ uri: source.url, name: source.name }, signal);
  }); };
  const select = (attachment: AudioAttachment) => {
    try {
      const file = audioFile(attachment.filename);
      if (!file.exists) throw new Error('missing');
      player.pause();
      player.replace({ uri: file.uri });
      setSelected(attachment.filename);
      setLoop(false); setStart('0'); setEnd(''); setError('');
    } catch { setError(t('Локальний аудіофайл недоступний. Видаліть запис та імпортуйте файл знову.')); }
  };
  const remove = (attachment: AudioAttachment) => Alert.alert(t('Видалити локальний аудіозапис?'), attachment.name, [
    { text: t('Скасувати'), style: 'cancel' },
    { text: t('Видалити'), style: 'destructive', onPress: () => { void run(async () => {
      if (selected === attachment.filename) { player.pause(); player.replace(null); setSelected(null); setLoop(false); }
      await removeAudioAttachment(db, songId, attachment.filename);
      if (alive.current) setAttachments((rows) => rows?.filter((row) => row.filename !== attachment.filename) ?? []);
    }); } },
  ]);
  const seek = async (time: number) => {
    try { await player.seekTo(time); }
    catch { if (alive.current) setError(t('Не вдалося перейти до фрагмента.')); }
  };
  const play = () => { void run(async () => {
    if (status.playing) { player.pause(); return; }
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    if (loop && validLoop && (status.currentTime < a || status.currentTime >= b)) await player.seekTo(a);
    else if (status.didJustFinish || status.currentTime >= status.duration) await player.seekTo(0);
    player.play();
  }); };
  const time = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  return <View style={{ gap: 12 }}>
    <H>{t('Аудіо для репетиції')}</H>
    <T muted>{t('Приватні локальні вкладення. Файли зберігаються на цьому пристрої для прослуховування офлайн. Нічого не завантажується на сервер.')}</T>
    <T muted>{t('MP3, M4A, WAV або AAC, до 50 МБ на файл.')}</T>
    {attachments === null && !error && <T muted>{t('Завантаження…')}</T>}
    {attachments === null && !!error && <Button title={t('Оновити')} onPress={() => setAttempt((n) => n + 1)} />}
    <Button kind="secondary" title={t('Додати аудіофайл')} onPress={pick} disabled={busy || attachments === null} />
    <Field value={url} onChangeText={setUrl} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="url"
      placeholder={t('Пряме HTTPS-посилання на аудіофайл')} accessibilityLabel={t('Пряме HTTPS-посилання на аудіофайл')} />
    <Button kind="secondary" title={t('Завантажити для офлайну')} onPress={download} disabled={busy || !url.trim() || attachments === null} />
    {busy && <Row wrap><T muted>{t('Обробка аудіо…')}</T><Button small kind="ghost" title={t('Скасувати')} onPress={() => operation.current?.abort()} /></Row>}
    {!!error && <T selectable accessibilityRole="alert">{error}</T>}
    {!!status.error && selected && <T selectable>{t('Не вдалося відтворити файл. Спробуйте інший аудіоформат.')}</T>}
    {attachments?.length === 0 && <T muted>{t('Аудіозаписів ще немає.')}</T>}
    {attachments?.map((attachment) => <View key={attachment.filename} style={{ gap: 6 }}>
      <T selectable style={{ fontWeight: selected === attachment.filename ? '700' : '400' }}>{attachment.name}</T>
      <T muted>{(attachment.size / 1024 / 1024).toFixed(1)} {t('МБ')}</T>
      <Row wrap>
        <Button small kind={selected === attachment.filename ? 'primary' : 'secondary'} title={t('Вибрати запис')} disabled={busy} onPress={() => select(attachment)} />
        <Button small kind="ghost" title={t('Видалити')} disabled={busy} onPress={() => remove(attachment)} />
      </Row>
    </View>)}
    {selected && <View style={{ gap: 10 }}>
      <T selectable>{time(status.currentTime)} / {time(status.duration)}</T>
      <Host matchContents={{ vertical: true }} accessibilityLabel={t('Позиція відтворення')}>
        <Slider value={Math.min(status.currentTime, status.duration || 1)} min={0} max={status.duration || 1} disabled={!status.isLoaded}
          onValueChange={(value) => { void seek(value); }} />
      </Host>
      <Button icon={status.playing ? 'pause' : 'play'} title={t(status.playing ? 'Пауза' : 'Відтворити')} disabled={busy || !status.isLoaded} onPress={play} />
      <Row wrap>
        <Button small kind="secondary" title={t('Початок A тут')} disabled={!status.isLoaded} onPress={() => setStart(status.currentTime.toFixed(2))} />
        <Button small kind="secondary" title={t('Кінець B тут')} disabled={!status.isLoaded} onPress={() => setEnd(status.currentTime.toFixed(2))} />
      </Row>
      <T muted>{t('Межі фрагмента в секундах (мінімум 0,25 с)')}</T>
      <Row>
        <Field style={{ flex: 1 }} value={start} onChangeText={setStart} keyboardType="decimal-pad" accessibilityLabel={t('Початок A, секунди')} />
        <Field style={{ flex: 1 }} value={end} onChangeText={setEnd} keyboardType="decimal-pad" placeholder={status.duration.toFixed(2)} accessibilityLabel={t('Кінець B, секунди')} />
      </Row>
      {!validLoop && <T muted>{t('Вкажіть A та B у межах запису, B має бути більшим за A.')}</T>}
      <Host matchContents={{ vertical: true }}>
        <Switch label={t('Повторювати фрагмент A–B')} value={loop && validLoop} disabled={!validLoop} onValueChange={setLoop} />
      </Host>
    </View>}
  </View>;
}
