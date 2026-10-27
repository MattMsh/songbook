import { Hono } from 'hono';
import { DEFAULT_PART_TYPES, parsePartTypes, type PartType } from '@songbook/shared';
import { requireAdmin } from './auth';
import { fail, readJson, type AppEnv } from './lib';

const KEY = 'part_types';

/** Song blocks: everyone reads them (songs are public), only admins change them. */
export const parts = new Hono<AppEnv>()
  .get('/', async (c) => {
    const value = await c.env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(KEY).first<string>('value');
    return c.json<PartType[]>(value ? JSON.parse(value) : DEFAULT_PART_TYPES);
  })
  .put('/', async (c) => {
    requireAdmin(c);
    const types = parsePartTypes((await readJson<{ types: unknown }>(c)).types);
    if ('error' in types) fail(400, 'bad_request', { field: types.error });
    await c.env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(KEY, JSON.stringify(types), Date.now())
      .run();
    return c.json(types);
  });
