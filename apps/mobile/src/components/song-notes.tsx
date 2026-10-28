import type { ParsedSong } from '@songbook/shared';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { loadSongNotes, MAX_NOTE_LENGTH, noteSections, personalSongKey, saveSongNote, type SongNote } from '@/lib/song-notes';
import { useAuth } from '@/lib/auth';
import { useT, useTheme } from '@/lib/settings';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { Button, Field, H, Row, T } from './ui';

/** Reload the reading view after returning from the separate editor, without exposing another account's notes. */
export function usePersonalSongNotes(songId: string) {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const scope = personalSongKey(songId, user?.id ?? null);
  const [loaded, setLoaded] = useState<{ scope: string; notes: SongNote[]; error: boolean }>();
  useFocusEffect(useCallback(() => {
    let active = true;
    loadSongNotes(db, scope).then((notes) => { if (active) setLoaded({ scope, notes, error: false }); })
      .catch(() => { if (active) setLoaded({ scope, notes: [], error: true }); });
    return () => { active = false; };
  }, [db, scope]));
  return loaded?.scope === scope ? loaded : { notes: [], error: false };
}

export function SongNotes({ songId, song, sectionKey }: { songId: string; song: ParsedSong; sectionKey?: string }) {
  const { user } = useAuth();
  const scopedId = personalSongKey(songId, user?.id ?? null);
  return <ScopedSongNotes key={scopedId} songId={scopedId} song={song} sectionKey={sectionKey} />;
}

function ScopedSongNotes({ songId, song, sectionKey }: { songId: string; song: ParsedSong; sectionKey?: string }) {
  const db = useSQLiteContext();
  const t = useT();
  const [notes, setNotes] = useState<SongNote[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, { dirty: boolean; saving: boolean }>>({});
  const onDraftChange = useCallback((key: string, dirty: boolean, saving: boolean) => {
    setDrafts((previous) => previous[key]?.dirty === dirty && previous[key]?.saving === saving
      ? previous : { ...previous, [key]: { dirty, saving } });
  }, []);
  useUnsavedChanges(Object.values(drafts).some((draft) => draft.dirty), Object.values(drafts).some((draft) => draft.saving));
  // Keep draft section identities stable if sync changes the song while this editor is open.
  const [editingSong] = useState(song);
  const sections = useMemo(() => noteSections(editingSong), [editingSong]);
  useEffect(() => {
    let alive = true;
    setNotes(null);
    setError(false);
    loadSongNotes(db, songId).then((rows) => { if (alive) setNotes(rows); }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [db, songId, attempt]);
  const orphaned = notes?.filter((note) => !sections.some((section) => section.key === note.section_key)) ?? [];
  const editors = notes === null ? [] : [
    ...sections.map((section, index) => notes.find((note) => note.section_key === section.key) ?? {
      section_key: section.key,
      label: section.label ?? t(section.kind === 'chorus' ? 'Приспів {n}' : section.kind === 'bridge' ? 'Бридж {n}' : 'Куплет {n}', { n: index + 1 }),
      preview: section.preview, text: '',
    }),
    ...orphaned,
  ].sort((a, b) => Number(b.section_key === sectionKey) - Number(a.section_key === sectionKey));
  return <View style={{ gap: 12 }}>
    <H>{t('Особисті нотатки')}</H>
    <T muted>{t('Лише на цьому пристрої. Не входять до тексту пісні та спільних пропозицій.')}</T>
    {error && <><T selectable>{t('Не вдалося завантажити нотатки.')}</T><Button title={t('Оновити')} onPress={() => setAttempt((n) => n + 1)} /></>}
    {!error && notes === null && <T muted>{t('Завантаження…')}</T>}
    {orphaned.length > 0 && <T selectable>{t('Секції змінилися. Старі нотатки збережено окремо — скопіюйте їх у потрібну секцію.')}</T>}
    {editors.map((note) => <NoteEditor key={note.section_key} songId={songId} note={note} onDraftChange={onDraftChange}
      onSaved={(saved) => setNotes((rows) => [...(rows ?? []).filter((row) => row.section_key !== saved.section_key), ...(saved.text.trim() ? [saved] : [])])} />)}
    {notes !== null && !editors.length && <T muted>{t('У пісні ще немає секцій для нотаток.')}</T>}
  </View>;
}

function NoteEditor({ songId, note, onSaved, onDraftChange }: {
  songId: string; note: SongNote; onSaved: (note: SongNote) => void;
  onDraftChange: (key: string, dirty: boolean, saving: boolean) => void;
}) {
  const db = useSQLiteContext();
  const t = useT();
  const { colors } = useTheme();
  const [text, setText] = useState(note.text);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { onDraftChange(note.section_key, text !== note.text, saving); }, [note.section_key, note.text, text, saving, onDraftChange]);
  useEffect(() => () => onDraftChange(note.section_key, false, false), [note.section_key, onDraftChange]);
  const save = async (next: string) => {
    setSaving(true);
    setFailed(false);
    const updated = { ...note, text: next };
    try { await saveSongNote(db, songId, updated); setText(next); onSaved(updated); }
    catch { setFailed(true); }
    finally { setSaving(false); }
  };
  return <View style={{ gap: 8, borderTopWidth: 1, borderColor: colors.border, paddingTop: 10 }}>
    <T selectable style={{ fontWeight: '600' }}>{note.label}</T>
    {!!note.preview && <T selectable muted numberOfLines={3}>{note.preview}</T>}
    <Field multiline textAlignVertical="top" style={{ minHeight: 90 }} value={text} onChangeText={setText}
      editable={!saving} maxLength={MAX_NOTE_LENGTH} placeholder={t('Ваша приватна нотатка')} accessibilityLabel={t('Нотатка до секції {name}', { name: note.label })} />
    {failed && <T selectable>{t('Не вдалося зберегти нотатку. Текст залишився в полі.')}</T>}
    <Row wrap>
      <Button small title={t(saving ? 'Збереження…' : 'Зберегти')} disabled={saving || text === note.text} onPress={() => { void save(text); }} />
      {!!note.text && <Button small kind="ghost" title={t('Очистити')} disabled={saving} onPress={() => { void save(''); }} />}
    </Row>
  </View>;
}
