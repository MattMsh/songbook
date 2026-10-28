import { Host } from '@expo/ui';
import { Button, Menu } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, controlSize, disabled, fixedSize, frame } from '@expo/ui/swift-ui/modifiers';
import type { MenuAction } from '@expo/ui/community/menu';
import type { BuilderMenuProps } from './builder-menu';

// Native labels keep menu triggers visible to VoiceOver, unlike RNHostView labels.
export function BuilderMenu({ title, label, actions, onAction, primary }: BuilderMenuProps) {
  const items = (list: MenuAction[]): React.ReactNode => list.map(action => action.subactions
    ? <Menu key={action.id ?? action.title} label={action.title}>{items(action.subactions)}</Menu>
    : <Button key={action.id ?? action.title} label={action.title}
        role={action.attributes?.destructive ? 'destructive' : 'default'}
        modifiers={[disabled(!!action.attributes?.disabled)]}
        onPress={() => onAction(action.id ?? action.title)} />);
  return <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ width: '100%', minHeight: 44 }}>
    <Menu label={title} modifiers={[accessibilityLabel(label ?? title), buttonStyle(primary ? 'borderedProminent' : 'bordered'), controlSize('large'), fixedSize({ horizontal: false, vertical: true }), frame({ minHeight: 44 })]}>
      {items(actions)}
    </Menu>
  </Host>;
}
