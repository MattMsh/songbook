import { describe, expect, it } from 'vitest';
import { parsePlanShareRequest, parsePlanShareSnapshot, SHARE_MAX_SONGS, SHARE_REQUEST_MAX_BYTES, SHARE_SNAPSHOT_MAX_BYTES } from '../src/sharing';

const request = { name: 'Неділя', songIds: ['song-1'], serviceDate: '2026-10-25',
  songSettings: { 'song-1': { transpose: 2, capo: -1, bpm: 120, notes: 'Вступ двічі' } } };
const snapshot = { version: 1, name: 'Неділя', songs: [{ id: 'song-1', chordpro: '{title: Святий}\n[C]Бог' }] };

describe('plan shares', () => {
  it('keeps intended plan metadata and excludes unrelated private fields', () => {
    const parsed = parsePlanShareRequest({ ...request, email: 'private@example.com', personalNotes: 'secret',
      audio: 'file://private', overrides: { chordpro: 'private' }, songSettings: { 'song-1': { transpose: 2, audio: 'secret' } } });
    expect(parsed).toEqual({ name: request.name, songIds: request.songIds, serviceDate: request.serviceDate,
      songSettings: { 'song-1': { transpose: 2 } } });
  });
  it('rejects malformed requests, local IDs, duplicates, invalid dates and settings', () => {
    for (const value of [null, [], {}, { ...request, songIds: [] }, { ...request, songIds: ['share:1:song-1'] },
      { ...request, songIds: ['a', 'a'] }, { ...request, serviceDate: '2026-02-30' },
      { ...request, songSettings: { missing: {} } }, { ...request, songSettings: { 'song-1': { transpose: 25 } } },
      { ...request, songIds: Array.from({ length: SHARE_MAX_SONGS + 1 }, (_, i) => `s${i}`) }])
      expect(() => parsePlanShareRequest(value)).toThrow();
  });
  it('bounds request bytes, including multibyte text', () => {
    expect(() => parsePlanShareRequest({ ...request, ignored: 'я'.repeat(SHARE_REQUEST_MAX_BYTES / 2) })).toThrow('size');
  });
  it('validates complete snapshots and removes fields not intended for public import', () => {
    const parsed = parsePlanShareSnapshot({ ...snapshot, email: 'secret', songs: [{ ...snapshot.songs[0], audio: 'secret' }] });
    expect(parsed).toEqual(snapshot);
    for (const value of [{ ...snapshot, version: 2 }, { ...snapshot, songs: [] },
      { ...snapshot, songs: [{ id: 'a', chordpro: '' }] }, { ...snapshot, songs: [{ id: 'a', chordpro: 'x'.repeat(100001) }] },
      { ...snapshot, ignored: 'x'.repeat(SHARE_SNAPSHOT_MAX_BYTES) }]) expect(() => parsePlanShareSnapshot(value)).toThrow();
  });
});
