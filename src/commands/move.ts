import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { requireOwnerOrAdmin, getSubcommandOption } from './_common.js';
import { ephemeral } from '../lib/respond.js';
import { DomainError } from '../lib/errors.js';

export interface Deps { store: Store; rest: DiscordRest; }

export async function handleMove(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  let ctx;
  try { ctx = await requireOwnerOrAdmin(interaction, env, store); }
  catch (e) { if (e instanceof DomainError) return ephemeral(e.userMessage); throw e; }

  const position = getSubcommandOption<number>(interaction, 'position');
  if (position === undefined) return ephemeral('❌ position が指定されていません');
  if (position < 0) return ephemeral('❌ position は 0 以上で指定してください');

  await rest.patchChannel(ctx.channelId, { position });
  return ephemeral(`✅ 並び順を \`${position}\` に変更しました`);
}
