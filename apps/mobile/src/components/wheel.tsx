import { Host, Picker } from '@expo/ui';

/** Native wheel picker on iOS; Android shows its standard dropdown. */
export function Wheel({
  items,
  index,
  onChange,
  width = 90,
  label,
}: {
  items: string[];
  index: number;
  onChange: (index: number) => void;
  width?: number;
  label: string;
}) {
  return (
    <Host matchContents={{ vertical: true }} style={{ width }} accessibilityLabel={label}>
      <Picker appearance="wheel" selectedValue={index} onValueChange={onChange}>
        {items.map((item, i) => (
          <Picker.Item key={i} label={item} value={i} />
        ))}
      </Picker>
    </Host>
  );
}
