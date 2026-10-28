-- Possession of the opaque token grants read access to this immutable plan snapshot.
CREATE TABLE share_links (
  token TEXT PRIMARY KEY NOT NULL CHECK (length(token) = 64),
  snapshot TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
