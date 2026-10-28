import { Hono } from 'hono';
import { parseAlbumPlan, PlanValidationError, type AlbumPlan, type SharedAlbum } from '@songbook/shared';
import { requireMusician } from './auth';
import { fail, readJson, type AppEnv } from './lib';

interface AlbumRow {
  id: string;
  name: string;
  song_ids: string;
  plan: string;
  created_at: number;
  updated_at: number;
}

const toAlbum = (r: AlbumRow): SharedAlbum => ({
  id: r.id,
  name: r.name,
  songIds: JSON.parse(r.song_ids),
  ...JSON.parse(r.plan),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function parseBody(body: Record<string, unknown>, current?: AlbumRow) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) fail(400, 'bad_request', { field: 'name' });
  const ids = body.songIds ?? [];
  if (!Array.isArray(ids) || ids.length > 500 || !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100))
    fail(400, 'bad_request', { field: 'songIds' });
  const songIds = [...new Set(ids as string[])];
  const plan: AlbumPlan = current ? JSON.parse(current.plan) : {};
  // Old clients can rename or reorder without erasing new plan fields.
  if (plan.songSettings)
    plan.songSettings = Object.fromEntries(Object.entries(plan.songSettings).filter(([id]) => songIds.includes(id)));
  for (const key of ['serviceDate', 'leader', 'notes', 'songSettings'] as const)
    if (Object.hasOwn(body, key)) Object.assign(plan, { [key]: body[key] });
  try {
    return { name, songIds, plan: JSON.stringify(parseAlbumPlan(plan, songIds)) };
  } catch (e) {
    if (e instanceof PlanValidationError) fail(400, 'bad_request', { field: e.field });
    throw e;
  }
}

async function validateSongs(db: D1Database, ids: string[], previous: string[] = []) {
  // D1 limits bound variables; keep each lookup below that limit.
  for (let start = 0; start < ids.length; start += 90) {
    const chunk = ids.slice(start, start + 90);
    const { results } = await db.prepare(
      `SELECT id, deleted_at FROM songs WHERE id IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).all<{ id: string; deleted_at: number | null }>();
    // Existing tombstones stay addressable so a deleted song cannot block every later plan edit.
    if (results.length !== chunk.length || results.some((song) => song.deleted_at !== null && !previous.includes(song.id))) fail(400, 'bad_request', { field: 'songIds' });
  }
}

/** Shared albums remain restricted to musicians and admins. */
export const albums = new Hono<AppEnv>()
  .get('/', async (c) => {
    requireMusician(c);
    const { results } = await c.env.DB.prepare('SELECT * FROM shared_albums ORDER BY created_at DESC').all<AlbumRow>();
    return c.json(results.map(toAlbum));
  })
  .post('/', async (c) => {
    const user = requireMusician(c);
    const { name, songIds, plan } = parseBody(await readJson(c));
    await validateSongs(c.env.DB, songIds);
    const now = Date.now();
    const row = await c.env.DB.prepare(
      'INSERT INTO shared_albums (id, name, song_ids, plan, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
      .bind(crypto.randomUUID(), name, JSON.stringify(songIds), plan, user.id, now, now)
      .first<AlbumRow>();
    return c.json(toAlbum(row!), 201);
  })
  .put('/:id', async (c) => {
    requireMusician(c);
    const current = await c.env.DB.prepare('SELECT * FROM shared_albums WHERE id = ?').bind(c.req.param('id')).first<AlbumRow>();
    if (!current) fail(404, 'not_found');
    const { name, songIds, plan } = parseBody(await readJson(c), current);
    await validateSongs(c.env.DB, songIds, JSON.parse(current.song_ids));
    const row = await c.env.DB.prepare('UPDATE shared_albums SET name = ?, song_ids = ?, plan = ?, updated_at = ? WHERE id = ? RETURNING *')
      .bind(name, JSON.stringify(songIds), plan, Date.now(), c.req.param('id'))
      .first<AlbumRow>();
    if (!row) fail(404, 'not_found');
    return c.json(toAlbum(row));
  })
  .delete('/:id', async (c) => {
    requireMusician(c);
    const res = await c.env.DB.prepare('DELETE FROM shared_albums WHERE id = ?').bind(c.req.param('id')).run();
    if (!res.meta.changes) fail(404, 'not_found');
    return c.json({ ok: true });
  });
