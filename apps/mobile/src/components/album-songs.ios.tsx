import { Host } from '@expo/ui';
import { Button, HStack, List, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, listRowSeparatorTint, listStyle } from '@expo/ui/swift-ui/modifiers';
import { songSubtitle } from '@/lib/db';
import { useTheme } from '@/lib/settings';
import type { AlbumSongsProps } from './album-songs';

/** Native list: hold a row and drag to reorder, swipe left to remove. */
export function AlbumSongs({ songs, onOpen, onReorder, onRemove }: AlbumSongsProps) {
  const { colors } = useTheme();
  // `to` counts positions before the moved rows are taken out.
  const move = (from: number[], to: number) => {
    const next = songs.filter((_, i) => !from.includes(i));
    next.splice(to - from.filter((i) => i < to).length, 0, ...from.map((i) => songs[i]));
    onReorder(next);
  };

  return (
    <Host style={{ flex: 1 }}>
      <List modifiers={[listStyle('plain')]}>
        {/* Albums are short set lists, so render every row and skip recycling. */}
        <List.ForEach
          data={songs}
          keyExtractor={(s) => s.id}
          recycling={false}
          onMove={move}
          onDelete={(indices) => indices.forEach((i) => onRemove(songs[i].id))}>
          {({ item, index }) => {
            const subtitle = songSubtitle(item);
            return (
              <Button onPress={() => onOpen(item.id)} modifiers={[listRowSeparatorTint(colors.separator)]}>
                <HStack>
                  <VStack alignment="leading" spacing={2}>
                    <Text modifiers={[lineLimit(1), foregroundStyle({ type: 'hierarchical', style: 'primary' })]}>
                      {`${index + 1}. ${item.title}`}
                    </Text>
                    {subtitle ? (
                      <Text
                        modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                        {subtitle}
                      </Text>
                    ) : null}
                  </VStack>
                  <Spacer />
                </HStack>
              </Button>
            );
          }}
        </List.ForEach>
      </List>
    </Host>
  );
}
