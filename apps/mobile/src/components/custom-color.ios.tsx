import { Host } from '@expo/ui';
import { ColorPicker } from '@expo/ui/swift-ui';
import { labelsHidden } from '@expo/ui/swift-ui/modifiers';

/** The system colour well: a rainbow circle that opens the iOS colour picker. */
export function CustomColor({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  return (
    <Host matchContents accessibilityLabel={label}>
      <ColorPicker selection={value} onSelectionChange={onChange} supportsOpacity={false} modifiers={[labelsHidden()]} />
    </Host>
  );
}
