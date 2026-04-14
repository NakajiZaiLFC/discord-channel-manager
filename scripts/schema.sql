CREATE TABLE IF NOT EXISTS channels (
  channel_id   TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  archived_at  TEXT                    -- NULL = active, not NULL = archived
);

CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_id);
CREATE INDEX IF NOT EXISTS idx_channels_archived ON channels(archived_at);
