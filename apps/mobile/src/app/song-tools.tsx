import { parseChordPro, type ParsedSong } from '@songbook/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { RehearsalAudio } from '@/components/rehearsal-audio';
import { PdfActions, ShareActions } from '@/components/share-actions';
import { SongNotes } from '@/components/song-notes';
import { Banner, Screen, T } from '@/components/ui';
import { getOverride, getSong, useRevision } from '@/lib/db';
import { useT } from '@/lib/settings';

/** Keep editing and export controls out of the live lyric view. */
export default function SongToolsScreen() {
  const { songId, album, tool, sectionKey } = useLocalSearchParams<{ songId?: string; album?: string; tool?: string; sectionKey?: string }>();
  const db = useSQLiteContext();
  const revision = useRevision();
  const t = useT();
  const albumId = album && /^\d+$/.test(album) && Number.isSafeInteger(Number(album)) && Number(album) > 0 ? Number(album) : undefined;
  const [loaded, setLoaded] = useState<{ id: string; song: ParsedSong | null }>();
  const [error, setError] = useState(false);
  const notes = tool === 'notes';
  const audio = tool === 'audio';
  const title = t(notes ? 'Особисті нотатки' : audio ? 'Аудіо для репетиції' : 'Поширення та PDF');

  useEffect(() => {
    if (!songId) return;
    let active = true;
    setError(false);
    Promise.all([getSong(db, songId), getOverride(db, songId)]).then(([song, override]) => {
      if (active) setLoaded({ id: songId, song: song ? parseChordPro(override?.chordpro ?? song.chordpro) : null });
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [db, songId, revision]);

  const invalid = (!songId && (notes || audio || !albumId)) || (songId && loaded?.id === songId && !loaded.song);
  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      {error ? <Banner kind="warn" text={t('Не вдалося завантажити пісню. Відкрийте її ще раз.')} />
        : invalid ? <T muted>{t('Пісню видалено або ще не синхронізовано')}</T>
        : songId && loaded?.id !== songId ? <T muted>{t('Завантаження…')}</T>
        : notes && songId && loaded?.song ? <SongNotes key={songId} songId={songId} song={loaded.song} sectionKey={sectionKey} />
        : audio && songId ? <RehearsalAudio key={songId} songId={songId} />
        : <>
          <ShareActions songId={songId} albumId={albumId} />
          <PdfActions songId={songId} albumId={albumId} />
        </>}
    </Screen>
  );
}
