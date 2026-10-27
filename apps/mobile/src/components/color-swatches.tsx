import { PART_COLORS, type PartColor } from '@songbook/shared';
import { Pressable, View } from 'react-native';
import { useT, useTheme } from '@/lib/settings';
import { Icon } from './ui';

const NAMES: Record<PartColor, string> = {
  orange: 'Помаранчевий',
  red: 'Червоний',
  pink: 'Рожевий',
  violet: 'Фіолетовий',
  blue: 'Синій',
  teal: 'Бірюзовий',
  green: 'Зелений',
  yellow: 'Жовтий',
  gray: 'Сірий',
};

/** One tappable circle per block colour, all in one row; the chosen one carries a check mark. */
export function ColorSwatches({ value, onChange, label }: { value: PartColor; onChange: (color: PartColor) => void; label: string }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {PART_COLORS.map((color) => (
        <Pressable
          key={color}
          accessibilityRole="radio"
          accessibilityLabel={t(NAMES[color])}
          accessibilityState={{ selected: color === value }}
          hitSlop={6}
          onPress={() => onChange(color)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: colors.parts[color],
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {color === value && <Icon name="check" size={16} color={colors.bg} />}
        </Pressable>
      ))}
    </View>
  );
}
