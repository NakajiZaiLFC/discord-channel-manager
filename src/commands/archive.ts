import type { APIApplicationCommandInteraction, APIInteractionResponse, APIChannel } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { requireOwnerOrAdmin } from './_common.js';
import { ephemeral } from '../lib/respond.js';
import { DomainError } from '../lib/errors.js';

export interface Deps { store: Store; rest: DiscordRest; }

export async function handleArchive(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  let ctx;
  try { ctx = await requireOwnerOrAdmin(interaction, env, store); }
  catch (e) { if (e instanceof DomainError) return ephemeral(e.userMessage); throw e; }

  const before = await rest.getChannel(ctx.channelId) as APIChannel & { name?: string };
  const originalName = before.name ?? 'channel';
  const newName = originalName.startsWith('[a]-') ? originalName : `[a]-${originalName}`;

  await rest.patchChannel(ctx.channelId, {
    name: newName,
    parent_id: env.ARCHIVE_CATEGORY_ID,
  });
  await store.markArchived(ctx.channelId);

  return ephemeral(`📦 アーカイブしました（${env.ARCHIVE_RETENTION_DAYS}日後に自動削除）`);
}
