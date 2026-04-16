import { createGuildChannel, addPermissionOverride, getGuildChannels } from './discord.js';
import { messages } from './messages.js';

interface Env {
  GUILD_ID: string;
  ADMIN_ROLE_IDS: string;
  PERSONAL_CHANNELS_CATEGORY_ID: string;
  DISCORD_TOKEN: string;
}

interface InteractionResponse {
  type: number;
  data?: { content: string; flags?: number };
}

function ephemeral(content: string): InteractionResponse {
  return { type: 4, data: { content, flags: 64 } };
}

function getOption(interaction: any, name: string): string | undefined {
  return interaction.data?.options?.[0]?.options?.find(
    (o: any) => o.name === name,
  )?.value;
}

function isAdmin(memberRoles: string[], adminRoleIds: string): boolean {
  const admins = adminRoleIds.split(',').map(s => s.trim());
  return memberRoles.some(r => admins.includes(r));
}

const MANAGE_CHANNELS = BigInt(0x10);

export async function handleCreate(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const userId: string = interaction.member.user.id;
  const admin = isAdmin(interaction.member.roles, env.ADMIN_ROLE_IDS);

  const name = getOption(interaction, 'name');
  if (!name) return ephemeral(messages.createNoName());

  if (!admin) {
    const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
    const owns = channels
      .filter(c => c.parent_id === env.PERSONAL_CHANNELS_CATEGORY_ID)
      .some(c =>
        c.permission_overwrites?.some(
          o => o.type === 1 && o.id === userId && (BigInt(o.allow) & MANAGE_CHANNELS) !== 0n,
        ),
      );
    if (owns) {
      return ephemeral(messages.createAlreadyOwns());
    }
  }

  const created = await createGuildChannel(env.DISCORD_TOKEN, env.GUILD_ID, {
    name,
    type: 0,
    parent_id: env.PERSONAL_CHANNELS_CATEGORY_ID,
  });

  await addPermissionOverride(env.DISCORD_TOKEN, created.id, userId);

  return ephemeral(messages.createSuccess(`<#${created.id}>`));
}

export async function handleClaim(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  if (!isAdmin(interaction.member.roles, env.ADMIN_ROLE_IDS)) {
    return ephemeral(messages.claimNotAdmin());
  }

  const target = getOption(interaction, 'user');
  if (!target) return ephemeral(messages.claimNoUser());

  const channelId: string = interaction.channel_id;
  await addPermissionOverride(env.DISCORD_TOKEN, channelId, target);

  return ephemeral(messages.claimSuccess(`<#${channelId}>`, `<@${target}>`));
}
