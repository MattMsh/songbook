import { describe, expect, it } from 'vitest';
import { effectiveCapo, effectiveSongSettings, parseAlbumPlan, parseSongSettings } from '../src/plans';

describe('service plans', () => {
  it('clamps capo offsets at the display and export boundary', () => {
    expect(effectiveCapo(3, -2)).toBe(1);
    expect(effectiveCapo(0, -12)).toBe(0);
    expect(effectiveCapo(11, 12)).toBe(11);
  });
  it('defaults to the written arrangement inside an album and personal settings outside it', () => {
    const personal = { transpose: 4, capo: -2 };
    expect(effectiveSongSettings(undefined, personal, true)).toMatchObject({ transpose: 0, capo: 0 });
    expect(effectiveSongSettings({ transpose: 0, capo: -1, bpm: 80 }, personal, true))
      .toMatchObject({ transpose: 0, capo: -1, bpm: 80 });
    expect(effectiveSongSettings({ transpose: 7 }, personal, false)).toMatchObject(personal);
  });

  it('accepts leap days, optional legacy plans, and explicit text clearing', () => {
    expect(parseAlbumPlan({}, [])).toEqual({});
    expect(parseAlbumPlan({ serviceDate: '2028-02-29', leader: '  Олена  ', notes: '' }, []))
      .toEqual({ serviceDate: '2028-02-29', leader: 'Олена' });
    expect(parseAlbumPlan({ serviceDate: '', leader: '', notes: '' }, [])).toEqual({});
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '0000-01-01', '26-01-01', '2026-1-01'])(
    'rejects invalid date %s', (serviceDate) => expect(() => parseAlbumPlan({ serviceDate }, [])).toThrow(),
  );

  it.each([NaN, Infinity, -Infinity, 1.5, '2', null])('rejects non-integer settings %s', (transpose) => {
    expect(() => parseSongSettings({ transpose })).toThrow();
  });

  it('checks ranges, text limits, object shapes, and membership', () => {
    for (const settings of [{ transpose: 25 }, { capo: -13 }, { bpm: 19 }, { bpm: 401 }, { notes: 'x'.repeat(5001) }])
      expect(() => parseSongSettings(settings)).toThrow();
    for (const plan of [null, [], { serviceDate: null }, { leader: 'x'.repeat(201) }, { notes: 'x'.repeat(10001) },
      { songSettings: [] }, { songSettings: { unknown: {} } }, { songSettings: { a: null } }])
      expect(() => parseAlbumPlan(plan, ['a'])).toThrow();
    expect(parseAlbumPlan({ songSettings: { a: { transpose: -24, capo: 12, bpm: 400, notes: 'Вступ' } } }, ['a']))
      .toEqual({ songSettings: { a: { transpose: -24, capo: 12, bpm: 400, notes: 'Вступ' } } });
  });
});
