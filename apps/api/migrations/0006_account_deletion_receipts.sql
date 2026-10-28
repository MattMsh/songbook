-- A one-way request fingerprint recovers a lost deletion response without retaining account identity.
CREATE TABLE account_deletion_receipts (
  request_hash TEXT PRIMARY KEY NOT NULL,
  apple_revocation INTEGER NOT NULL CHECK (apple_revocation IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX account_deletion_receipts_created ON account_deletion_receipts(created_at);
