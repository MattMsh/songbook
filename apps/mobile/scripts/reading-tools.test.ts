/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseChordPro } from '@songbook/shared';
import { usePreventRemove } from 'expo-router';
import { Alert } from 'react-native';
import { draftChanged, localCalendarDate, parseLocalCalendarDate } from '../src/lib/draft-values';
import { noteSections } from '../src/lib/song-notes';
import { useUnsavedChanges } from '../src/lib/use-unsaved-changes';

const state = vi.hoisted(() => ({ setDiscarded: vi.fn() }));
vi.mock('react', () => ({
  useState: () => [false, state.setDiscarded],
  useEffect: (callback: () => void) => callback(),
}));
vi.mock('expo-router', () => ({ usePreventRemove: vi.fn() }));
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));
vi.mock('../src/lib/settings', () => ({ useT: () => (key: string) => key }));
beforeEach(() => vi.clearAllMocks());
const originalTimezone = process.env.TZ;
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe('reading-only note anchors', () => {
  it('anchors comment-labelled notes immediately after their own block', () => {
    const song = parseChordPro('{c: Куплет 1}\n[C]First\n\n{c: Приспів}\n[G]Second');
    const sections = noteSections(song);
    expect(sections.map((section) => section.label)).toEqual(['Куплет 1', 'Приспів']);
    expect(sections.map((section) => `${section.sectionIndex}:${section.endLine - 1}`)).toEqual(['0:2', '0:4']);
    expect(sections[0].preview).toBe('First');
    expect(sections[1].preview).toBe('Second');
  });
  it('retains existing keys while adding render anchors and isolates edited sections', () => {
    const song = parseChordPro('{sov: Verse}\n[C]One\n{eov}\n{soc: Chorus}\n[G]Two\n{eoc}');
    const sections = noteSections(song);
    for (const section of sections) {
      const original = song.sections[section.sectionIndex];
      expect(section.key).toBe(JSON.stringify([original.kind, original.label, original.lines.filter((line) => line.type !== 'empty')]));
      expect(section.endLine).toBe(original.lines.length);
    }
    const changed = noteSections(parseChordPro('{sov: Verse}\n[C]Changed\n{eov}\n{soc: Chorus}\n[G]Two\n{eoc}'));
    expect(changed[0].key).not.toBe(sections[0].key);
    expect(changed[1].key).toBe(sections[1].key);
  });
  it('keeps duplicate section anchors distinct and does not attach notes after a structural change', () => {
    const verse = '{sov: Verse}\n[C]One\n{eov}';
    const sections = noteSections(parseChordPro(`${verse}\n${verse}`));
    expect(new Set(sections.map((section) => `${section.sectionIndex}:${section.endLine}`)).size).toBe(2);
    expect(new Set(sections.map((section) => section.key)).size).toBe(2);
    const changed = noteSections(parseChordPro(`${verse}\n${verse}\n{soc}\nOther\n{eoc}`));
    expect(changed.some((section) => sections.some((old) => old.key === section.key))).toBe(false);
  });
});

describe('local service dates', () => {
  it.each(['Pacific/Kiritimati', 'America/Los_Angeles', 'Europe/Kyiv'])('round-trips calendar dates without UTC shifts in %s', (timezone) => {
    process.env.TZ = timezone;
    for (const date of ['2026-03-29', '2026-11-01', '2026-12-31', '2028-02-29']) {
      const parsed = parseLocalCalendarDate(date)!;
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.getHours()).toBe(12);
      expect(localCalendarDate(parsed)).toBe(date);
    }
    expect(localCalendarDate(new Date(2026, 11, 31, 23, 45))).toBe('2026-12-31');
    expect(localCalendarDate(new Date(2026, 0, 1, 0, 15))).toBe('2026-01-01');
  });
  it('rejects invalid calendar dates rather than normalizing them into another month', () => {
    for (const value of ['', '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '0000-01-01', '2026-1-2', '2026-01-02T00:00Z']) {
      expect(parseLocalCalendarDate(value)).toBeUndefined();
    }
    expect(() => localCalendarDate(new Date(NaN))).toThrow('Invalid date');
  });
});

describe('draft dismissal protection', () => {
  it('compares editable strings without marking untouched optional values dirty', () => {
    expect(draftChanged(null, {})).toBe(false);
    expect(draftChanged({ serviceDate: '', leader: '', notes: '' }, {})).toBe(false);
    expect(draftChanged({ notes: 'Private draft' }, { notes: 'Saved' })).toBe(true);
    expect(draftChanged({ bpm: '', notes: '' }, { bpm: '', notes: '' })).toBe(false);
    expect(draftChanged({ bpm: '120', notes: '' }, { bpm: '', notes: '' })).toBe(true);
  });
  it('allows clean navigation and explicit cancellation without prompting', () => {
    const cancel = useUnsavedChanges(false);
    expect(vi.mocked(usePreventRemove).mock.calls[0][0]).toBe(false);
    const proceed = vi.fn(); cancel(proceed);
    expect(proceed).toHaveBeenCalledOnce();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
  it('blocks back or swipe removal until the user confirms discard', () => {
    useUnsavedChanges(true);
    const [protectedRoute, callback] = vi.mocked(usePreventRemove).mock.calls[0];
    expect(protectedRoute).toBe(true);
    const repeat = vi.fn();
    callback!({ data: { action: { type: 'GO_BACK' } }, repeat });
    expect(repeat).not.toHaveBeenCalled();
    const buttons = vi.mocked(Alert.alert).mock.calls[0][2]!;
    expect(buttons[0].style).toBe('cancel');
    buttons[1].onPress!();
    expect(state.setDiscarded).toHaveBeenCalledWith(true);
    expect(repeat).toHaveBeenCalledOnce();
  });
  it('uses the same confirmation for explicit cancel and does not discard during a save', () => {
    const discard = useUnsavedChanges(true);
    const proceed = vi.fn(); discard(proceed);
    expect(proceed).not.toHaveBeenCalled();
    vi.mocked(Alert.alert).mock.calls[0][2]![1].onPress!();
    expect(proceed).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    const whileSaving = useUnsavedChanges(false, true);
    expect(vi.mocked(usePreventRemove).mock.calls[0][0]).toBe(true);
    const blocked = vi.fn(); whileSaving(blocked);
    expect(blocked).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Збереження…', 'Зачекайте, доки зміни буде збережено.');
  });
});
