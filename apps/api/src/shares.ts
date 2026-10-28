import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { parsePlanShareRequest, parsePlanShareSnapshot, SHARE_REQUEST_MAX_BYTES, SHARE_TOKEN_RE } from '@songbook/shared';
import { requireUser } from './auth';
import { fail, randomHex, type AppEnv } from './lib';

/** Public links contain immutable canonical snapshots, not a user's local song edits. */
export const shares = new Hono<AppEnv>()
  .post('/', (c, next) => { requireUser(c); return next(); },
    bodyLimit({ maxSize: SHARE_REQUEST_MAX_BYTES, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
    async (c) => {
      const user = requireUser(c);
      const input = await c.req.json().catch(() => fail(400, 'bad_request'));
      let request;
      try { request = parsePlanShareRequest(input); }
      catch { return fail(400, 'bad_request'); }
      const { results } = await c.env.DB.prepare(
        `SELECT id, chordpro FROM songs WHERE deleted_at IS NULL AND id IN (${request.songIds.map(() => '?').join(',')})`,
      ).bind(...request.songIds).all<{ id: string; chordpro: string }>();
      const byId = new Map(results.map((song) => [song.id, song]));
      const missingSongIds = request.songIds.filter((id) => !byId.has(id));
      if (missingSongIds.length) fail(400, 'missing_songs', { songIds: missingSongIds });
      const { songIds, ...plan } = request;
      let snapshot;
      try { snapshot = parsePlanShareSnapshot({ version: 1, ...plan, songs: songIds.map((id) => byId.get(id)) }); }
      catch { return fail(413, 'payload_too_large'); }
      const token = randomHex();
      await c.env.DB.prepare('INSERT INTO share_links (token, snapshot, created_by, created_at) VALUES (?, ?, ?, ?)')
        .bind(token, JSON.stringify(snapshot), user.id, Date.now()).run();
      return c.json({ token }, 201);
    })
  .get('/:token', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    const token = c.req.param('token');
    if (!SHARE_TOKEN_RE.test(token)) fail(404, 'not_found');
    const row = await c.env.DB.prepare('SELECT snapshot FROM share_links WHERE token = ?')
      .bind(token).first<{ snapshot: string }>();
    if (!row) fail(404, 'not_found');
    return c.json(parsePlanShareSnapshot(JSON.parse(row.snapshot)));
  });
