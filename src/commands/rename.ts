import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { requireOwnerOrAdmin, getSubcommandOption } from './_common.js';
import { ephemeral } from '../lib/respond.js';
import { DomainError } from '../lib/errors.js';

export interface Deps { store: Store; rest: DiscordRest; }

export async function handleRename(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  let ctx;
  try { ctx = await requireOwnerOrAdmin(interaction, env, store); }
  catch (e) { if (e instanceof DomainError) return ephemeral(e.userMessage); throw e; }

  const newName = getSubcommandOption<string>(interaction, 'new_name');
  if (!newName) return ephemeral('❌ new_name が指定されていません');

  await rest.patchChannel(ctx.channelId, { name: newName });
  return ephemeral(`✅ チャンネル名を \`${newName}\` に変更しました`);
}
