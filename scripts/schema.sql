CREATE TABLE IF NOT EXISTS channels (
  channel_id        TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  last_modified_at  TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'text'
                      CHECK (kind IN ('text', 'voice', 'category'))
);

CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_id);

CREATE TABLE IF NOT EXISTS nonces (
  nonce        TEXT PRIMARY KEY,
  actor_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at);
