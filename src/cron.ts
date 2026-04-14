import { createStore } from './ownership/store.js';
import { createDiscordRest } from './discord/rest.js';
import type { Env } from './config.js';

export async function runCleanup(env: Env): Promise<{ deleted: number; failures: number }> {
  const store = createStore(env.DB as D1Database);
  const rest = createDiscordRest(env.DISCORD_TOKEN);

  const cutoffMs = Date.now() - env.ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const rows = await store.listArchivedBefore(cutoffIso);
  let deleted = 0;
  let failures = 0;
  for (const row of rows) {
    try {
      await rest.deleteChannel(row.channel_id);
      await store.deleteChannel(row.channel_id);
      deleted++;
    } catch (e) {
      console.error('[cron] delete failed', { channel_id: row.channel_id, error: (e as Error).message });
      failures++;
    }
  }
  return { deleted, failures };
}
