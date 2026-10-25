import { Host } from '@expo/ui';
import { Button, ContextMenu, HStack, Image, List, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, listRowSeparatorTint, listStyle } from '@expo/ui/swift-ui/modifiers';
import { SONGS } from '@/lib/i18n';
import { useT, useTheme } from '@/lib/settings';
import type { AlbumListProps } from './album-list';

/** Native list of albums: tap to open, hold for rename/delete, swipe left to delete. */
export function AlbumList({ albums, onOpen, onDelete, onRename, onAskDelete }: AlbumListProps) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <Host style={{ flex: 1 }}>
      <List modifiers={[listStyle('plain')]}>
        <List.ForEach
          data={albums}
          keyExtractor={(a) => String(a.id)}
          recycling={false}
          onDelete={(indices) => indices.forEach((i) => onDelete(albums[i].id))}>
          {({ item }) => (
            <ContextMenu modifiers={[listRowSeparatorTint(colors.separator)]}>
              <ContextMenu.Trigger>
                <Button onPress={() => onOpen(item.id)}>
                  <HStack>
                    <VStack alignment="leading" spacing={2}>
                      <Text modifiers={[lineLimit(1), foregroundStyle({ type: 'hierarchical', style: 'primary' })]}>{item.name}</Text>
                      <Text
                        modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                        {t(SONGS, { count: item.count })}
                      </Text>
                    </VStack>
                    <Spacer />
                    <Image
                      systemName="chevron.right"
                      modifiers={[
                        font({ textStyle: 'footnote', weight: 'semibold' }),
                        foregroundStyle({ type: 'hierarchical', style: 'tertiary' }),
                      ]}
                    />
                  </HStack>
                </Button>
              </ContextMenu.Trigger>
              <ContextMenu.Items>
                <Button systemImage="pencil" label={t('Перейменувати')} onPress={() => onRename(item)} />
                <Button systemImage="trash" label={t('Видалити')} role="destructive" onPress={() => onAskDelete(item)} />
              </ContextMenu.Items>
            </ContextMenu>
          )}
        </List.ForEach>
      </List>
    </Host>
  );
}
