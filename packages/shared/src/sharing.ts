import { parseAlbumPlan } from './plans';
import type { AlbumPlan } from './types';

export const SHARE_REQUEST_MAX_BYTES = 64 * 1024;
export const SHARE_SNAPSHOT_MAX_BYTES = 1024 * 1024;
export const SHARE_MAX_SONGS = 100;
export const SHARE_TOKEN_RE = /^[a-f0-9]{64}$/;
export const PUBLIC_SONG_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export interface PlanShareRequest extends AlbumPlan {
  name: string;
  songIds: string[];
}

export interface PlanShareSnapshot extends AlbumPlan {
  version: 1;
  name: string;
  songs: { id: string; chordpro: string }[];
}

export class ShareValidationError extends Error {}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ShareValidationError('object');
  return value as Record<string, unknown>;
}

function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new ShareValidationError('name');
  return value.trim();
}

function songIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > SHARE_MAX_SONGS ||
      !value.every((id) => typeof id === 'string' && PUBLIC_SONG_ID_RE.test(id)) || new Set(value).size !== value.length)
    throw new ShareValidationError('songIds');
  return value;
}

/** Whitelist public plan fields; never copy personal data from the caller. */
export function parsePlanShareRequest(value: unknown): PlanShareRequest {
  if (bytes(value) > SHARE_REQUEST_MAX_BYTES) throw new ShareValidationError('size');
  const source = object(value);
  const ids = songIds(source.songIds);
  return { name: name(source.name), songIds: ids, ...parseAlbumPlan(source, ids) };
}

/** Validate both stored snapshots and untrusted link responses before offline import. */
export function parsePlanShareSnapshot(value: unknown): PlanShareSnapshot {
  if (bytes(value) > SHARE_SNAPSHOT_MAX_BYTES) throw new ShareValidationError('size');
  const source = object(value);
  if (source.version !== 1 || !Array.isArray(source.songs)) throw new ShareValidationError('version');
  const songs = source.songs.map((value) => {
    const song = object(value);
    if (typeof song.chordpro !== 'string' || !song.chordpro.trim() || song.chordpro.length > 100_000)
      throw new ShareValidationError('chordpro');
    return { id: song.id as string, chordpro: song.chordpro };
  });
  const ids = songIds(songs.map((song) => song.id));
  return { version: 1, name: name(source.name), songs, ...parseAlbumPlan(source, ids) };
}
