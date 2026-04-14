import { ChannelType } from '../discord/types.js';
import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { isAdmin } from '../ownership/permissions.js';
import { getSubcommandOption } from './_common.js';
import { ephemeral } from '../lib/respond.js';

export interface Deps { store: Store; rest: DiscordRest; }

export async function handleCreate(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  const actorId = interaction.member!.user.id;
  const actorRoles = interaction.member!.roles;
  const admin = isAdmin(actorRoles, env.ADMIN_ROLE_IDS);

  // Reject if run inside the personal channels category
  const from = await rest.getChannel(interaction.channel_id as string);
  if ((from as { parent_id?: string | null }).parent_id === env.PERSONAL_CHANNELS_CATEGORY_ID) {
    return ephemeral('❌ このコマンドは個人chカテゴリ外で実行してください');
  }

  const name = getSubcommandOption<string>(interaction, 'name');
  if (!name) return ephemeral('❌ name が指定されていません');

  if (!admin && await store.hasActiveChannel(actorId)) {
    return ephemeral('❌ 既にチャンネルを所有しています（1人1チャンネル制限）');
  }

  const created = await rest.createGuildChannel(env.GUILD_ID, {
    name,
    type: ChannelType.GuildText,
    parent_id: env.PERSONAL_CHANNELS_CATEGORY_ID,
  });

  if (admin) {
    await store.insertChannel({ channel_id: created.id, owner_id: actorId });
  } else {
    await store.insertChannelIfNoneOwned({ channel_id: created.id, owner_id: actorId });
  }

  return ephemeral(`✅ チャンネルを作成しました → <#${created.id}>`);
}
