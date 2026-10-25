import { ScrollView } from 'react-native';
import { songSubtitle, type SongListItem } from '@/lib/db';
import { Button, ListItem, Row } from './ui';
import { useT } from '@/lib/settings';

export interface AlbumSongsProps {
  songs: SongListItem[];
  onOpen: (songId: string) => void;
  onReorder: (songs: SongListItem[]) => void;
  onRemove: (songId: string) => void;
}

/** Fallback for non-iOS platforms: arrow buttons instead of drag to reorder. */
export function AlbumSongs({ songs, onOpen, onReorder, onRemove }: AlbumSongsProps) {
  const t = useT();
  const swap = (i: number, j: number) => {
    const next = [...songs];
    [next[i], next[j]] = [next[j], next[i]];
    onReorder(next);
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      {songs.map((s, i) => (
        <ListItem
          key={s.id}
          title={`${i + 1}. ${s.title}`}
          subtitle={songSubtitle(s)}
          onPress={() => onOpen(s.id)}
          right={
            <Row gap={4}>
              <Button small kind="ghost" icon="up" label={t('Вище')} disabled={i === 0} onPress={() => swap(i, i - 1)} />
              <Button small kind="ghost" icon="down" label={t('Нижче')} disabled={i === songs.length - 1} onPress={() => swap(i, i + 1)} />
              <Button small kind="ghost" icon="close" label={t('Прибрати з альбому')} onPress={() => onRemove(s.id)} />
            </Row>
          }
        />
      ))}
    </ScrollView>
  );
}
