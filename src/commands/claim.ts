import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import { isAdmin } from '../ownership/permissions.js';
import { getSubcommandOption } from './_common.js';
import { ephemeral } from '../lib/respond.js';

export interface Deps { store: Store; }

export async function handleClaim(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const actorRoles = interaction.member!.roles;
  if (!isAdmin(actorRoles, env.ADMIN_ROLE_IDS)) {
    return ephemeral('❌ このコマンドは管理者専用です');
  }

  const target = getSubcommandOption<string>(interaction, 'user');
  if (!target) return ephemeral('❌ 対象ユーザーが指定されていません');

  const channelId = interaction.channel_id as string;
  if (await deps.store.getOwnerOf(channelId)) {
    return ephemeral('❌ このチャンネルは既に登録されています');
  }

  await deps.store.insertChannel({ channel_id: channelId, owner_id: target });
  return ephemeral(`✅ <#${channelId}> のオーナーを <@${target}> に登録しました`);
}
