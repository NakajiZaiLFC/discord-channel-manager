import type { CommandRouter } from '../interactions/command-router.js';
import { createStore } from '../ownership/store.js';
import { createDiscordRest } from '../discord/rest.js';
import { handleCreate } from './create.js';
import { handleRename } from './rename.js';
import { handleMove } from './move.js';
import { handleArchive } from './archive.js';
import { handleClaim } from './claim.js';

export function registerCommands(router: CommandRouter): void {
  router.register('channel', 'create', async (interaction, env) => {
    const store = createStore(env.DB as D1Database);
    const rest = createDiscordRest(env.DISCORD_TOKEN);
    return handleCreate(interaction, env, { store, rest });
  });
  router.register('channel', 'rename', async (interaction, env) => {
    const store = createStore(env.DB as D1Database);
    const rest = createDiscordRest(env.DISCORD_TOKEN);
    return handleRename(interaction, env, { store, rest });
  });
  router.register('channel', 'move', async (interaction, env) => {
    const store = createStore(env.DB as D1Database);
    const rest = createDiscordRest(env.DISCORD_TOKEN);
    return handleMove(interaction, env, { store, rest });
  });
  router.register('channel', 'archive', async (interaction, env) => {
    const store = createStore(env.DB as D1Database);
    const rest = createDiscordRest(env.DISCORD_TOKEN);
    return handleArchive(interaction, env, { store, rest });
  });
  router.register('channel', 'claim', async (interaction, env) => {
    const store = createStore(env.DB as D1Database);
    return handleClaim(interaction, env, { store });
  });
}
