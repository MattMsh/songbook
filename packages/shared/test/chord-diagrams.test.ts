import { describe, expect, it } from 'vitest';
import { guitarFrets, pianoPitchClasses, pitchClassName } from '../src/chord-diagrams';
import { chordContext, mod12, parseChord } from '../src/chords';

const tuning = [4, 9, 2, 7, 11, 4];
const played = (chord: string) => guitarFrets(chord)!.flatMap((fret, i) => fret === null ? [] : [mod12(tuning[i] + fret)]);

describe('chord diagrams', () => {
  it('uses the existing B/H convention and distinguishes Bb', () => {
    expect(guitarFrets('H')).toEqual(guitarFrets('B'));
    expect(guitarFrets('Hb')).toEqual(guitarFrets('Bb'));
    expect(pianoPitchClasses('H')!.notes).toEqual([11, 3, 6]);
    expect(pianoPitchClasses('Bb')!.notes).toEqual([10, 2, 5]);
    expect(pitchClassName(11, 'german')).toBe('H');
  });

  it('all movable and open shapes contain only chord tones and retain essential tones', () => {
    for (const root of ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']) {
      for (const quality of ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', '7sus4', 'dim', 'dim7', 'm7b5', 'aug']) {
        const chord = root + quality;
        const notes = played(chord);
        const expected = pianoPitchClasses(chord)!.notes;
        expect(notes.every((note) => expected.includes(note)), chord).toBe(true);
        // Open C7 omits its optional perfect fifth.
        expect(new Set(notes), chord).toEqual(new Set(chord === 'C7' ? expected.filter((pc) => pc !== 7) : expected));
        expect(notes[0], `${chord} bass`).toBe(parseChord(chord)!.root);
      }
    }
  });

  it('honors the bass of verified inversions and reports unsupported shapes honestly', () => {
    for (const chord of ['C/E', 'G/B', 'D/F#', 'Am/G']) {
      expect(played(chord)[0]).toBe(parseChord(chord)!.bass);
      expect(new Set(played(chord))).toEqual(new Set(pianoPitchClasses(chord)!.notes));
    }
    expect(guitarFrets('C/F#')).toBeNull();
    expect(pianoPitchClasses('C/F#')).toEqual({ notes: [0, 4, 7, 6], bass: 6 });
    expect(guitarFrets('C9')).toBeNull();
    expect(pianoPitchClasses('C13')).toBeNull();
    expect(guitarFrets('not a chord')).toBeNull();
    expect(pianoPitchClasses('not a chord')).toBeNull();
  });

  it('distinguishes minor, major seventh, dominant, suspended and diminished notes', () => {
    expect(pianoPitchClasses('Cm')!.notes).toEqual([0, 3, 7]);
    expect(pianoPitchClasses('Cmaj7')!.notes).toEqual([0, 4, 7, 11]);
    expect(pianoPitchClasses('C7')!.notes).toEqual([0, 4, 7, 10]);
    expect(pianoPitchClasses('Csus')!.notes).toEqual([0, 5, 7]);
    expect(pianoPitchClasses('C°7')!.notes).toEqual([0, 3, 6, 9]);
    expect(pianoPitchClasses('Cø')!.notes).toEqual([0, 3, 6, 10]);
    expect(pianoPitchClasses('CM7')).toEqual(pianoPitchClasses('Cmaj7'));
    expect(pianoPitchClasses('Cmin7')).toEqual(pianoPitchClasses('Cm7'));
  });

  it('uses the rendered shape plus capo for sounding piano notes after transposition', () => {
    const ctx = chordContext({ key: 'D', chords: ['C/E'], notation: 'english', transpose: 3, capo: 4, songCapo: 2 });
    const displayed = ctx.map('C/E');
    expect(displayed).toBe('Db/F');
    expect(pianoPitchClasses(displayed, 4)).toEqual({ notes: [5, 9, 0], bass: 9 });
    expect(pianoPitchClasses(displayed, 12)).toBeNull();
    expect(pianoPitchClasses(displayed, -1)).toBeNull();
    expect(pianoPitchClasses(displayed, 1.5)).toBeNull();
  });
});
