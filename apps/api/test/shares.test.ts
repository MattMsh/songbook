import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { SHARE_REQUEST_MAX_BYTES, SHARE_TOKEN_RE, type User } from '@songbook/shared';
import { shares } from '../src/shares';
import { HttpError, type AppEnv } from '../src/lib';

const user: User = { id: 'u1', email: 'private@example.com', name: 'Private', role: 'member' };
const canonical = { id: 's1', chordpro: '{title: Public}\n[C]Public lyrics' };
function fixture(authenticated = true) {
  const stored = new Map<string, string>();
  const db = { prepare(sql: string) {
    let args: unknown[] = [];
    return { bind(...values: unknown[]) { args = values; return this; },
      async all() { return { results: args.includes('s1') ? [canonical] : [] }; },
      async first() { return stored.has(String(args[0])) ? { snapshot: stored.get(String(args[0])) } : null; },
      async run() { if (sql.startsWith('INSERT INTO share_links')) stored.set(String(args[0]), String(args[1])); return {}; } };
  } };
  const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('user', authenticated ? user : null); await next(); }).route('/shares', shares);
  app.onError((error, c) => error instanceof HttpError ? c.json({ error: error.code, ...error.extra }, error.status) : c.json({ error: 'internal' }, 500));
  const env = { DB: db } as unknown as AppEnv['Bindings'];
  const post = (body: unknown) => app.request('/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  return { post, get: (token: string) => app.request(`/shares/${token}`, {}, env), stored };
}

describe('public plan link API', () => {
  it('requires authentication even for a member and before reading the payload', async () => {
    expect((await fixture(false).post({ name: 'Plan', songIds: ['s1'] })).status).toBe(401);
  });
  it('bounds actual body bytes and validates JSON and plan membership', async () => {
    const f = fixture();
    expect((await f.post({ name: 'Plan', songIds: ['s1'], unused: 'я'.repeat(SHARE_REQUEST_MAX_BYTES) })).status).toBe(413);
    for (const body of [[], { name: '', songIds: ['s1'] }, { name: 'Plan', songIds: ['s1', 's1'] },
      { name: 'Plan', songIds: ['s1'], songSettings: { missing: {} } }]) expect((await f.post(body)).status).toBe(400);
    expect(f.stored.size).toBe(0);
  });
  it('rejects unavailable songs instead of publishing a partial snapshot', async () => {
    const f = fixture();
    const response = await f.post({ name: 'Plan', songIds: ['s1', 'missing'] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_songs', songIds: ['missing'] });
    expect(f.stored.size).toBe(0);
  });
  it('uses high-entropy opaque tokens and canonical lyrics, never caller overrides or user email', async () => {
    const f = fixture();
    const response = await f.post({ name: 'Plan', songIds: ['s1'], notes: 'Public plan notes',
      overrides: { s1: 'PRIVATE LYRICS' }, email: user.email, personalNotes: 'SECRET', audio: 'file://private' });
    expect(response.status).toBe(201);
    const { token } = await response.json() as { token: string };
    expect(token).toMatch(SHARE_TOKEN_RE);
    const publicResponse = await f.get(token);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('Cache-Control')).toBe('no-store');
    expect(await publicResponse.json()).toEqual({ version: 1, name: 'Plan', notes: 'Public plan notes', songs: [canonical] });
    expect(f.stored.get(token)).not.toContain(user.email);
    const anonymous = fixture(false);
    anonymous.stored.set(token, f.stored.get(token)!);
    expect((await anonymous.get(token)).status).toBe(200);
    expect((await f.get('a'.repeat(64))).status).toBe(404);
    expect((await f.get('guessable')).status).toBe(404);
  });
});
