export interface ChannelRow {
  channel_id: string;
  owner_id: string;
  created_at: string;
  archived_at: string | null;
}

export interface InsertArgs {
  channel_id: string;
  owner_id: string;
}

export interface Store {
  getOwnerOf(channelId: string): Promise<string | null>;
  get(channelId: string): Promise<ChannelRow | null>;
  hasActiveChannel(ownerId: string): Promise<boolean>;
  insertChannel(args: InsertArgs): Promise<void>;
  insertChannelIfNoneOwned(args: InsertArgs): Promise<boolean>;
  markArchived(channelId: string): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
  listArchivedBefore(cutoffIso: string): Promise<ChannelRow[]>;
}

export function createStore(db: D1Database): Store {
  return {
    async getOwnerOf(channelId) {
      const row = await db.prepare('SELECT owner_id FROM channels WHERE channel_id = ?')
        .bind(channelId).first<{ owner_id: string }>();
      return row?.owner_id ?? null;
    },
    async get(channelId) {
      return db.prepare('SELECT * FROM channels WHERE channel_id = ?')
        .bind(channelId).first<ChannelRow>();
    },
    async hasActiveChannel(ownerId) {
      const row = await db.prepare(
        'SELECT COUNT(*) as c FROM channels WHERE owner_id = ? AND archived_at IS NULL',
      ).bind(ownerId).first<{ c: number }>();
      return (row?.c ?? 0) > 0;
    },
    async insertChannel({ channel_id, owner_id }) {
      const now = new Date().toISOString();
      await db.prepare(
        'INSERT INTO channels (channel_id, owner_id, created_at, archived_at) VALUES (?, ?, ?, NULL)',
      ).bind(channel_id, owner_id, now).run();
    },
    async insertChannelIfNoneOwned({ channel_id, owner_id }) {
      const now = new Date().toISOString();
      const res = await db.prepare(
        `INSERT INTO channels (channel_id, owner_id, created_at, archived_at)
         SELECT ?, ?, ?, NULL
         WHERE NOT EXISTS (SELECT 1 FROM channels WHERE owner_id = ? AND archived_at IS NULL)`,
      ).bind(channel_id, owner_id, now, owner_id).run();
      return (res.meta.changes ?? 0) > 0;
    },
    async markArchived(channelId) {
      const now = new Date().toISOString();
      await db.prepare('UPDATE channels SET archived_at = ? WHERE channel_id = ?')
        .bind(now, channelId).run();
    },
    async deleteChannel(channelId) {
      await db.prepare('DELETE FROM channels WHERE channel_id = ?').bind(channelId).run();
    },
    async listArchivedBefore(cutoffIso) {
      const res = await db.prepare(
        'SELECT * FROM channels WHERE archived_at IS NOT NULL AND archived_at < ?',
      ).bind(cutoffIso).all<ChannelRow>();
      return res.results;
    },
  };
}
