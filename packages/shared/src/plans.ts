import type { AlbumPlan, SongSettings } from './types';

export class PlanValidationError extends Error {
  constructor(public field: string) {
    super(`Invalid plan field: ${field}`);
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlanValidationError(field);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, limit: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > limit) throw new PlanValidationError(field);
  return value.trim() || undefined;
}

/** Empty strings clear optional text fields. Unknown fields are not persisted. */
export function parseSongSettings(value: unknown): SongSettings {
  const source = object(value, 'songSettings');
  const result: SongSettings = {};
  for (const [key, min, max] of [['transpose', -24, 24], ['capo', -12, 12], ['bpm', 20, 400]] as const) {
    const n = source[key];
    if (n === undefined) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max)
      throw new PlanValidationError(key);
    result[key] = n;
  }
  const notes = text(source.notes, 'notes', 5000);
  if (notes !== undefined) result.notes = notes;
  return result;
}

/** Validates calendar dates without timezone conversion and settings against album membership. */
export function parseAlbumPlan(value: unknown, songIds: readonly string[]): AlbumPlan {
  const source = object(value, 'plan');
  const result: AlbumPlan = {};
  const date = text(source.serviceDate, 'serviceDate', 10);
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000'))
      throw new PlanValidationError('serviceDate');
    const parsed = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
      throw new PlanValidationError('serviceDate');
    result.serviceDate = date;
  }
  const leader = text(source.leader, 'leader', 200);
  const notes = text(source.notes, 'notes', 10000);
  if (leader !== undefined) result.leader = leader;
  if (notes !== undefined) result.notes = notes;
  if (source.songSettings !== undefined) {
    const entries = Object.entries(object(source.songSettings, 'songSettings'));
    if (entries.length > 500) throw new PlanValidationError('songSettings');
    const ids = new Set(songIds);
    result.songSettings = Object.fromEntries(entries.map(([id, settings]) => {
      if (!ids.has(id)) throw new PlanValidationError('songSettings');
      return [id, parseSongSettings(settings)];
    }));
  }
  return result;
}

/** A changed source capo must not move an offset beyond the supported fret range. */
export const effectiveCapo = (songCapo: number, offset = 0): number => Math.max(0, Math.min(11, songCapo + offset));

/** Album offsets default to the written arrangement, never to personal offsets. */
export function effectiveSongSettings(plan: SongSettings | undefined, personal: SongSettings | undefined, inAlbum: boolean) {
  const source = inAlbum ? plan : personal;
  return { transpose: source?.transpose ?? 0, capo: source?.capo ?? 0, bpm: source?.bpm, notes: source?.notes };
}
