import { Stack } from 'expo-router';
import { Text } from 'react-native';
import { ColorSwatches } from '@/components/color-swatches';
import { Button, Card, Row, Screen, T } from '@/components/ui';
import { usePartStyle } from '@/lib/parts';
import { useSettings, useT } from '@/lib/settings';

/** Everyone's own colours for song blocks; the admin's colour stays the default. */
export default function PartColorsScreen() {
  const t = useT();
  const { settings, update } = useSettings();
  const { types, colorOf } = usePartStyle();
  const own = settings.partColors;

  const reset = (id: string) => {
    const { [id]: _, ...rest } = own;
    update({ partColors: rest });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('Кольори блоків') }} />
      <T muted style={{ fontSize: 13 }}>{t('Колір назви блоку та його акордів. Змінюється лише на цьому пристрої.')}</T>
      {types.map((type) => (
        <Card key={type.id}>
          <Row>
            <Text accessibilityRole="header" style={{ flex: 1, color: colorOf(type), fontSize: 15, fontWeight: '700' }}>
              {type.name.toUpperCase()}
            </Text>
            {own[type.id] && <Button small kind="ghost" title={t('Типово')} onPress={() => reset(type.id)} />}
          </Row>
          <ColorSwatches
            label={type.name}
            value={own[type.id] ?? type.color}
            onChange={(color) => update({ partColors: { ...own, [type.id]: color } })}
          />
        </Card>
      ))}
      {Object.keys(own).length > 0 && (
        <Button kind="secondary" title={t('Скинути всі кольори')} onPress={() => update({ partColors: {} })} />
      )}
    </Screen>
  );
}
