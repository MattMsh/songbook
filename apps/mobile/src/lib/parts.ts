import { DEFAULT_PART_TYPES, matchPart, type PartColor, type PartType } from '@songbook/shared';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { useSettings, useTheme } from './settings';

/** The admin's song block list, cached on the device so labels keep their colours offline. */
const KEY = 'part_types';

function load(): PartType[] {
  try {
    return JSON.parse(Storage.getItemSync(KEY) ?? 'null') ?? DEFAULT_PART_TYPES;
  } catch {
    return DEFAULT_PART_TYPES;
  }
}

let types = load();
const listeners = new Set<() => void>();

/** Called by sync and by the admin screen after a save. */
export function setPartTypes(next: PartType[]) {
  types = next;
  Storage.setItemSync(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

export const usePartTypes = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => types,
  );

/** Finds the block a label names and its colour: the user's own choice, else the admin's. */
export function usePartStyle() {
  const types = usePartTypes();
  const { partColors } = useSettings().settings;
  const { colors } = useTheme();
  // A picked colour is one shade for both themes; palette keys adapt to light and dark.
  const colorOf = (type: PartType) => {
    const own = partColors[type.id];
    return own?.startsWith('#') ? own : colors.parts[(own as PartColor | undefined) ?? type.color];
  };
  return { types, colorOf, match: (label: string) => matchPart(label, types) };
}
