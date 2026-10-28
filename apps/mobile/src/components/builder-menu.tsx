import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { View } from 'react-native';
import { useTheme } from '@/lib/settings';
import { T } from './ui';

export interface BuilderMenuProps {
  title: string;
  label?: string;
  actions: MenuAction[];
  onAction: (action: string) => void;
  primary?: boolean;
}

export function BuilderMenu({ title, label, actions, onAction, primary }: BuilderMenuProps) {
  const { colors } = useTheme();
  return <MenuView actions={actions} onPressAction={e => onAction(e.nativeEvent.event)} style={{ maxWidth: '100%' }}>
    <View accessible accessibilityRole="button" accessibilityLabel={label ?? title}
      style={{ minHeight: 48, padding: 12, borderRadius: 10, backgroundColor: primary ? colors.accent : colors.fill }}>
      <T style={{ color: primary ? colors.onAccent : colors.onFill }}>{title}</T>
    </View>
  </MenuView>;
}
