import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createStore } from '../../src/ownership/store.js';
import { applyMigrations } from '../setup.js';

beforeEach(async () => { await applyMigrations(); });

describe('OwnershipStore', () => {
  it('getOwnerOf returns null for unknown channel', async () => {
    const store = createStore(env.DB as D1Database);
    expect(await store.getOwnerOf('nope')).toBeNull();
  });

  it('insertChannel → getOwnerOf returns owner', async () => {
    const store = createStore(env.DB as D1Database);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1' });
    expect(await store.getOwnerOf('c1')).toBe('u1');
  });

  it('insertChannelIfNoneOwned succeeds when user has no active channel', async () => {
    const store = createStore(env.DB as D1Database);
    const ok = await store.insertChannelIfNoneOwned({ channel_id: 'c1', owner_id: 'u1' });
    expect(ok).toBe(true);
    expect(await store.hasActiveChannel('u1')).toBe(true);
  });

  it('insertChannelIfNoneOwned fails when user already owns an active channel', async () => {
    const store = createStore(env.DB as D1Database);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1' });
    const ok = await store.insertChannelIfNoneOwned({ channel_id: 'c2', owner_id: 'u1' });
    expect(ok).toBe(false);
  });

  it('insertChannelIfNoneOwned ignores archived channels', async () => {
    const store = createStore(env.DB as D1Database);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1' });
    await store.markArchived('c1');
    const ok = await store.insertChannelIfNoneOwned({ channel_id: 'c2', owner_id: 'u1' });
    expect(ok).toBe(true);
  });

  it('markArchived sets archived_at', async () => {
    const store = createStore(env.DB as D1Database);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1' });
    await store.markArchived('c1');
    const row = await store.get('c1');
    expect(row?.archived_at).not.toBeNull();
  });

  it('deleteChannel removes row', async () => {
    const store = createStore(env.DB as D1Database);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1' });
    await store.deleteChannel('c1');
    expect(await store.getOwnerOf('c1')).toBeNull();
  });

  it('listArchivedBefore returns only rows with archived_at < cutoff', async () => {
    const store = createStore(env.DB as D1Database);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1' });
    await store.insertChannel({ channel_id: 'c2', owner_id: 'u2' });
    await store.markArchived('c1');
    // Archive c1 "in the past" by setting archived_at via direct SQL
    await env.DB.prepare('UPDATE channels SET archived_at = ? WHERE channel_id = ?')
      .bind('2000-01-01T00:00:00Z', 'c1').run();
    await store.markArchived('c2'); // c2 archived "now"
    const old = await store.listArchivedBefore('2020-01-01T00:00:00Z');
    expect(old.length).toBe(1);
    expect(old[0]?.channel_id).toBe('c1');
  });
});
