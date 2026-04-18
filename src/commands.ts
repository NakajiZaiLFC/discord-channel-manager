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
  data?: {
    content?: string;
    flags?: number;
    components?: any[];
    choices?: Array<{ name: string; value: string | number }>;
  };
}

function ephemeral(content: string, components?: any[]): InteractionResponse {
  return { type: 4, data: { content, flags: 64, components } };
}

function getOption(interaction: any, name: string): string | undefined {
  return interaction.data?.options?.find((o: any) => o.name === name)?.value;
}

function isAdmin(memberRoles: string[], adminRoleIds: string): boolean {
  const admins = adminRoleIds.split(',').map(s => s.trim());
  return memberRoles.some(r => admins.includes(r));
}

const MANAGE_CHANNELS = BigInt(0x10);
const GUILD_CATEGORY = 4;

// --- /marvin-create ---

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

// --- /marvin-claim ---

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

// --- /marvin-move <category> autocomplete サジェスト ---

export async function handleMoveAutocomplete(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
  const categories = channels
    .filter(c => c.type === GUILD_CATEGORY)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const focused = (interaction.data?.options ?? []).find((o: any) => o.focused);
  const query = String(focused?.value ?? '').toLowerCase();

  const filtered = categories
    .filter(c => !query || (c.name ?? '').toLowerCase().includes(query))
    .slice(0, 25)
    .map(c => ({
      name: (c.name ?? '(名前なし)').slice(0, 100),
      value: c.id,
    }));

  return {
    type: 8, // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
    data: { choices: filtered },
  };
}

// --- /marvin-move 実行 ---

export async function handleMove(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const categoryId = (interaction.data?.options ?? []).find((o: any) => o.name === 'category')?.value;
  if (!categoryId) return ephemeral('❌ カテゴリが指定されていません');

  if (!/^\d{15,25}$/.test(String(categoryId))) {
    return ephemeral('❌ カテゴリ名を候補から選択してください');
  }

  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
  const target = channels.find(c => c.id === categoryId && c.type === GUILD_CATEGORY);
  if (!target) return ephemeral('❌ 指定されたカテゴリが見つかりません');

  const channelId: string = interaction.channel_id;
  await patchChannel(env.DISCORD_TOKEN, channelId, { parent_id: String(categoryId) });

  return ephemeral(`✅ カテゴリを「${target.name}」に移動しました`);
}

// --- /marvin-help ---

export function handleHelp(): InteractionResponse {
  return ephemeral(
    '📖 **コマンド一覧**\n\n' +
    '`/marvin-create <name>` — 新しいチャンネルを作成（1人1ch）\n' +
    '`/marvin-claim <@user>` — [admin] 既存chにオーナーを割り当て\n' +
    '`/marvin-move` — このチャンネルのカテゴリを移動\n' +
    '`/marvin-help` — このヘルプを表示',
  );
}
