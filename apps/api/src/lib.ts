import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Role, SyncSong, User } from '@songbook/shared';

export type Bindings = Env & { RESEND_API_KEY?: string };
export type AppEnv = { Bindings: Bindings; Variables: { user: User | null } };
export type Ctx = Context<AppEnv>;

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function fail(status: ContentfulStatusCode, code: string, extra?: Record<string, unknown>): never {
  throw new HttpError(status, code, extra);
}

export async function readJson<T>(c: Ctx): Promise<Partial<T>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === 'object' ? (body as Partial<T>) : {};
}

export function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim() || v.length > 100_000) fail(400, 'bad_request', { field });
  return v;
}

/** Strictly increasing `updated_at` (bind `Date.now()`), so clock skew never hides a write from sync. */
export const NEXT_TS = '(SELECT MAX(?, COALESCE(MAX(updated_at), 0) + 1) FROM songs)';

export const isUniqueError = (e: unknown) => String(e).includes('UNIQUE constraint failed');

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}

export const randomHex = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

export interface SongRow {
  id: string;
  number: number | null;
  title: string;
  key: string | null;
  bpm: number | null;
  time_sig: string | null;
  rhythm: string | null;
  chordpro: string;
  version: number;
  updated_at: number;
  deleted_at: number | null;
}

export const toSong = (r: SongRow): SyncSong => ({
  id: r.id,
  number: r.number,
  title: r.title,
  key: r.key,
  bpm: r.bpm,
  timeSig: r.time_sig,
  rhythm: r.rhythm,
  chordpro: r.chordpro,
  version: r.version,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

const adminEmails = (env: Bindings) =>
  new Set(env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));

/** `ADMIN_EMAILS` always wins over the stored role. */
export const toUser = (r: UserRow, env: Bindings): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: adminEmails(env).has(r.email.toLowerCase()) ? 'admin' : r.role,
});
