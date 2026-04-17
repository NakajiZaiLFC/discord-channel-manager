import { createGuildChannel, addPermissionOverride, getGuildChannels, patchChannel } from './discord.js';
import { messages } from './messages.js';

interface Env {
  GUILD_ID: string;
  ADMIN_ROLE_IDS: string;
  PERSONAL_CHANNELS_CATEGORY_ID: string;
  DISCORD_TOKEN: string;
}

interface InteractionResponse {
  type: number;
  data?: { content: string; flags?: number; components?: any[] };
}

function ephemeral(content: string, components?: any[]): InteractionResponse {
  return { type: 4, data: { content, flags: 64, components } };
}

function updateMessage(content: string): InteractionResponse {
  return { type: 7, data: { content, components: [] } };
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
const GUILD_CATEGORY = 4;

// --- /channel create ---

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

// --- /channel claim ---

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

// --- /move → セレクトメニュー表示 ---

export async function handleMove(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
  const categories = channels
    .filter(c => c.type === GUILD_CATEGORY)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  if (categories.length === 0) {
    return ephemeral('カテゴリが見つかりません');
  }

  // Discord StringSelect は最大25件
  const options = categories.slice(0, 25).map(c => ({
    label: c.name ?? '(名前なし)',
    value: c.id,
  }));

  return ephemeral('📁 移動先のカテゴリを選択してください', [
    {
      type: 1, // ActionRow
      components: [
        {
          type: 3, // StringSelect
          custom_id: 'move-category',
          placeholder: 'カテゴリを選択',
          options,
        },
      ],
    },
  ]);
}

// --- セレクト選択後の処理 ---

export async function handleMoveSelect(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const selectedId: string = interaction.data?.values?.[0];
  if (!selectedId) return updateMessage('❌ 選択が無効です');

  const channelId: string = interaction.channel_id;

  // カテゴリ名を取得して表示に使う
  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
  const target = channels.find(c => c.id === selectedId);

  await patchChannel(env.DISCORD_TOKEN, channelId, { parent_id: selectedId });

  return updateMessage(`✅ カテゴリを「${target?.name ?? selectedId}」に移動しました`);
}

// --- /help ---

export function handleHelp(): InteractionResponse {
  return ephemeral(
    '📖 **コマンド一覧**\n\n' +
    '`/channel create <name>` — 新しいチャンネルを作成（1人1ch）\n' +
    '`/channel claim <@user>` — [admin] 既存chにオーナーを割り当て\n' +
    '`/move` — このチャンネルのカテゴリを移動\n' +
    '`/help` — このヘルプを表示',
  );
}
