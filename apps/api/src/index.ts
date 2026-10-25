import { Hono } from 'hono';
import type { Role } from '@songbook/shared';
import { albums } from './albums';
import { auth, loadUser, requireAdmin, requireUser } from './auth';
import { fail, HttpError, readJson, toUser, type AppEnv, type UserRow } from './lib';
import { proposals } from './proposals';
import { songs, sync } from './songs';

const ROLES: Role[] = ['admin', 'musician', 'member'];

const users = new Hono<AppEnv>()
  .get('/', async (c) => {
    requireAdmin(c);
    const { results } = await c.env.DB.prepare('SELECT * FROM users ORDER BY email').all<UserRow>();
    return c.json(results.map((r) => toUser(r, c.env)));
  })
  .patch('/:id', async (c) => {
    requireAdmin(c);
    const { role } = await readJson<{ role: Role }>(c);
    if (!role || !ROLES.includes(role)) fail(400, 'bad_request', { field: 'role' });
    const row = await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ? RETURNING *')
      .bind(role, c.req.param('id'))
      .first<UserRow>();
    if (!row) fail(404, 'not_found');
    return c.json(toUser(row, c.env));
  });

const app = new Hono<AppEnv>()
  .use(loadUser)
  .get('/health', (c) => c.json({ ok: true }))
  .get('/me', (c) => c.json({ user: requireUser(c) }))
  .route('/auth', auth)
  .route('/sync', sync)
  .route('/songs', songs)
  .route('/albums', albums)
  .route('/proposals', proposals)
  .route('/users', users);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((e, c) => {
  if (e instanceof HttpError) return c.json({ error: e.code, ...e.extra }, e.status);
  console.error(e);
  return c.json({ error: 'internal' }, 500);
});

export default app;
