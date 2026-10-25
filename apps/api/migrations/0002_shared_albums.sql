-- Set lists shared by musicians. The whole album is one row, so every write replaces it (last write wins).
CREATE TABLE shared_albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  song_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of song ids, in set-list order
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
