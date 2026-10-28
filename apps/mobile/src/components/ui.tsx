import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ColorValue,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/lib/settings';

/** One entry per meaning: SF Symbol on iOS, Material Symbol on Android. */
const ICONS = {
  add: { ios: 'plus', android: 'add' },
  remove: { ios: 'minus', android: 'remove' },
  close: { ios: 'xmark', android: 'close' },
  edit: { ios: 'square.and.pencil', android: 'edit_note' },
  rename: { ios: 'pencil', android: 'edit' },
  trash: { ios: 'trash', android: 'delete' },
  up: { ios: 'arrow.up', android: 'arrow_upward' },
  down: { ios: 'arrow.down', android: 'arrow_downward' },
  back: { ios: 'chevron.left', android: 'chevron_left' },
  forward: { ios: 'chevron.right', android: 'chevron_right' },
  expand: { ios: 'chevron.down', android: 'keyboard_arrow_down' },
  collapse: { ios: 'chevron.up', android: 'keyboard_arrow_up' },
  play: { ios: 'play.fill', android: 'play_arrow' },
  pause: { ios: 'pause.fill', android: 'pause' },
  haptics: { ios: 'iphone.radiowaves.left.and.right', android: 'vibration' },
  sound: { ios: 'speaker.wave.2.fill', android: 'volume_up' },
  soundOff: { ios: 'speaker.slash.fill', android: 'volume_off' },
  backspace: { ios: 'delete.left', android: 'backspace' },
  upload: { ios: 'icloud.and.arrow.up', android: 'cloud_upload' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh' },
  queue: { ios: 'tray.full', android: 'inbox' },
  people: { ios: 'person.2', android: 'group' },
  lyrics: { ios: 'text.alignleft', android: 'notes' },
  addToAlbum: { ios: 'text.badge.plus', android: 'playlist_add' },
  check: { ios: 'checkmark', android: 'check' },
  palette: { ios: 'paintpalette', android: 'palette' },
  blocks: { ios: 'square.stack.3d.up', android: 'view_agenda' },
  checked: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  globe: { ios: 'globe', android: 'language' },
  singer: { ios: 'music.mic', android: 'mic' },
  musician: { ios: 'guitars', android: 'piano' },
  unchecked: { ios: 'circle', android: 'radio_button_unchecked' },
} satisfies Record<string, Extract<SymbolViewProps['name'], object>>;

export type IconName = keyof typeof ICONS;

const MIN_TOUCH_SIZE = Platform.OS === 'android' ? 48 : 44;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: ColorValue }) {
  // Semibold matches button labels; Android keeps the bundled regular weight.
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} weight="semibold" />;
}

/** Header options shared by the root stack and the per-tab stacks. */
export function useStackOptions() {
  const { colors } = useTheme();
  return {
    // An explicit background keeps the header opaque on iOS 26 (no content under the glass header).
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.accent,
    headerTitleStyle: { color: colors.text },
    headerBackButtonDisplayMode: 'minimal' as const,
  };
}

export function T({ muted, style, ...props }: TextProps & { muted?: boolean }) {
  const { colors } = useTheme();
  return <Text {...props} style={[{ color: muted ? colors.muted : colors.text, fontSize: 16 }, style]} />;
}

export function H({ children }: { children: ReactNode }) {
  return <T accessibilityRole="header" style={styles.h}>{children}</T>;
}

export function Screen({ children, padded = true }: { children: ReactNode; padded?: boolean }) {
  const { colors } = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={padded && styles.screen}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic">
      {children}
    </ScrollView>
  );
}

export function Button({
  title,
  icon,
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy = false,
  small,
}: {
  title?: string;
  icon?: IconName;
  /** Screen reader label for icon-only buttons. */
  label?: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
}) {
  const { colors } = useTheme();
  const bg = { primary: colors.accent, secondary: colors.fill, danger: colors.danger, ghost: 'transparent' }[kind];
  const fg = { primary: colors.onAccent, secondary: colors.onFill, danger: colors.onDanger, ghost: colors.accent }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: !!(disabled || busy), busy }}
      style={({ pressed }) => [
        styles.button,
        small && styles.small,
        { backgroundColor: bg, opacity: disabled || busy ? 0.4 : pressed ? 0.7 : 1 },
      ]}>
      {icon && <Icon name={icon} size={small ? 16 : 18} color={fg} />}
      {title && <Text style={{ color: fg, fontSize: small ? 14 : 16, fontWeight: '600', flexShrink: 1, textAlign: 'center' }}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.chip, { backgroundColor: active ? colors.accent : colors.fill, opacity: pressed ? 0.7 : 1 }]}>
      <Text style={{ color: active ? colors.onAccent : colors.onFill, fontWeight: '600', flexShrink: 1, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  const { colors } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[styles.field, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }, props.style]}
    />
  );
}

export function Row({ children, wrap, gap = 8, style }: { children: ReactNode; wrap?: boolean; gap?: number; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', flexWrap: wrap ? 'wrap' : 'nowrap', gap }, style]}>{children}</View>;
}

export function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.card }]}>{children}</View>;
}

export function Banner({ text, kind = 'info' }: { text: string; kind?: 'info' | 'warn' }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityRole={kind === 'warn' ? 'alert' : 'text'} accessibilityLiveRegion={kind === 'warn' ? 'assertive' : 'polite'} style={[styles.banner, { backgroundColor: kind === 'warn' ? colors.del : colors.card }]}>
      <T style={{ fontSize: 14 }}>{text}</T>
    </View>
  );
}

export function ListItem({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.item, { borderColor: colors.separator, opacity: pressed ? 0.6 : 1 }]}>
      <View style={{ flex: 1 }}>
        <T style={{ fontSize: 17 }} numberOfLines={1}>
          {title}
        </T>
        {subtitle ? (
          <T muted style={{ fontSize: 13 }} numberOfLines={1}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Extra bottom room keeps the last controls clear of the floating tab bar.
  screen: { padding: 16, paddingBottom: 48, gap: 12 },
  h: { fontSize: 17, fontWeight: '600', marginTop: 8 },
  button: {
    minHeight: MIN_TOUCH_SIZE,
    minWidth: MIN_TOUCH_SIZE,
    maxWidth: '100%',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  small: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  chip: { minHeight: MIN_TOUCH_SIZE, minWidth: MIN_TOUCH_SIZE, maxWidth: '100%', flexShrink: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  field: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, borderCurve: 'continuous', padding: 12, fontSize: 16 },
  card: { borderRadius: 12, borderCurve: 'continuous', padding: 12, gap: 10 },
  banner: { borderRadius: 10, borderCurve: 'continuous', padding: 10 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
