import { Hono } from 'hono';
import type { SharedAlbum } from '@songbook/shared';
import { requireMusician } from './auth';
import { fail, readJson, type AppEnv } from './lib';

interface AlbumRow {
  id: string;
  name: string;
  song_ids: string;
  created_at: number;
  updated_at: number;
}

const toAlbum = (r: AlbumRow): SharedAlbum => ({
  id: r.id,
  name: r.name,
  songIds: JSON.parse(r.song_ids),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function parseBody(body: Partial<{ name: unknown; songIds: unknown }>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) fail(400, 'bad_request', { field: 'name' });
  const ids = body.songIds ?? [];
  if (!Array.isArray(ids) || ids.length > 500 || !ids.every((id) => typeof id === 'string' && id.length <= 100))
    fail(400, 'bad_request', { field: 'songIds' });
  return { name, songIds: JSON.stringify([...new Set(ids as string[])]) };
}

/** Shared albums: musicians and admins only. The list is small, so clients fetch it whole. */
export const albums = new Hono<AppEnv>()
  .get('/', async (c) => {
    requireMusician(c);
    const { results } = await c.env.DB.prepare('SELECT * FROM shared_albums ORDER BY created_at DESC').all<AlbumRow>();
    return c.json(results.map(toAlbum));
  })
  .post('/', async (c) => {
    const user = requireMusician(c);
    const { name, songIds } = parseBody(await readJson(c));
    const now = Date.now();
    const row = await c.env.DB.prepare(
      'INSERT INTO shared_albums (id, name, song_ids, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
    )
      .bind(crypto.randomUUID(), name, songIds, user.id, now, now)
      .first<AlbumRow>();
    return c.json(toAlbum(row!), 201);
  })
  .put('/:id', async (c) => {
    requireMusician(c);
    const { name, songIds } = parseBody(await readJson(c));
    const row = await c.env.DB.prepare('UPDATE shared_albums SET name = ?, song_ids = ?, updated_at = ? WHERE id = ? RETURNING *')
      .bind(name, songIds, Date.now(), c.req.param('id'))
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
