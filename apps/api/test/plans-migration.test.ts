/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

it('adds plan metadata without changing existing API album data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY);");
    db.exec(readFileSync(new URL('../migrations/0002_shared_albums.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO shared_albums(id,name,song_ids,created_at,updated_at)
      VALUES ('old','Existing','["b","a"]',123,456)`);
    db.exec(readFileSync(new URL('../migrations/0004_service_plans.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT * FROM shared_albums').get()).toMatchObject({
      id: 'old', name: 'Existing', song_ids: '["b","a"]', plan: '{}', created_at: 123, updated_at: 456,
    });
  } finally { db.close(); }
});
