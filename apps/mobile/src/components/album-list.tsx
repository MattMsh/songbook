import { ScrollView } from 'react-native';
import type { Album } from '@/lib/db';
import { SONGS } from '@/lib/i18n';
import { useT, useTheme } from '@/lib/settings';
import { Icon, ListItem } from './ui';

export interface AlbumListProps {
  albums: Album[];
  onOpen: (albumId: number) => void;
  /** Swipe to delete: removes right away. */
  onDelete: (albumId: number) => void;
  /** Long-press menu actions. */
  onRename: (album: Album) => void;
  onAskDelete: (album: Album) => void;
}

/** Fallback for non-iOS platforms: albums are deleted from the album screen. */
export function AlbumList({ albums, onOpen }: AlbumListProps) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      {albums.map((a) => (
        <ListItem
          key={a.id}
          title={a.name}
          subtitle={t(SONGS, { count: a.count })}
          right={<Icon name="forward" size={16} color={colors.muted} />}
          onPress={() => onOpen(a.id)}
        />
      ))}
    </ScrollView>
  );
}
